import mongoose from 'mongoose';
import { connectToDatabase } from '../db/mongo';
import { UserModel } from '../models/user';
import { MembershipModel } from '../models/membership';
import { TenantModel } from '../models/tenant';

const main = async () => {
  const emailArg = process.argv[2];
  const email = (emailArg ?? '').trim().toLowerCase();

  if (!email) {
    console.error('Usage: yarn ts-node-dev --transpile-only --exit-child src/scripts/grantAdminByEmail.ts <email>');
    process.exit(1);
  }

  await connectToDatabase();

  const user = await UserModel.findOne({ email });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const memberships = await MembershipModel.find({ userId: user._id }).select({
    tenantId: 1,
    role: 1,
    status: 1
  });

  if (memberships.length === 0) {
    console.error(`No memberships found for user: ${email}`);
    process.exit(1);
  }

  await MembershipModel.updateMany({ userId: user._id }, { $set: { role: 'ADMIN' } });

  const updatedMemberships = await MembershipModel.find({ userId: user._id }).select({
    tenantId: 1,
    role: 1,
    status: 1
  });

  const tenantIds = updatedMemberships.map((membership) => membership.tenantId);
  const tenants = await TenantModel.find({ _id: { $in: tenantIds } }).select({ name: 1, status: 1 });
  const tenantMap = new Map(tenants.map((tenant) => [tenant._id.toString(), tenant]));

  console.log(
    JSON.stringify(
      {
        ok: true,
        user: {
          id: user._id.toString(),
          email: user.email
        },
        memberships: updatedMemberships.map((membership) => ({
          tenantId: membership.tenantId.toString(),
          tenantName: tenantMap.get(membership.tenantId.toString())?.name ?? null,
          tenantStatus: tenantMap.get(membership.tenantId.toString())?.status ?? null,
          role: membership.role,
          status: membership.status
        }))
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
