import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { connectToDatabase } from './db/mongo';
import { UserModel } from './models/user';
import { TenantModel } from './models/tenant';
import { MembershipModel } from './models/membership';

const seed = async () => {
  await connectToDatabase();

  const [tenantAlpha, tenantBravo] = await Promise.all([
    TenantModel.findOneAndUpdate(
      { name: 'Alpha Cricket' },
      { name: 'Alpha Cricket', status: 'ACTIVE' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    TenantModel.findOneAndUpdate(
      { name: 'Bravo Cricket' },
      { name: 'Bravo Cricket', status: 'ACTIVE' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ]);

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  const user = await UserModel.findOneAndUpdate(
    { email: 'admin@cricket.local' },
    {
      email: 'admin@cricket.local',
      passwordHash,
      fullName: 'Cricket Admin',
      status: 'ACTIVE'
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Promise.all([
    MembershipModel.findOneAndUpdate(
      { userId: user._id, tenantId: tenantAlpha._id },
      {
        userId: user._id,
        tenantId: tenantAlpha._id,
        role: 'ADMIN',
        status: 'ACTIVE'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    MembershipModel.findOneAndUpdate(
      { userId: user._id, tenantId: tenantBravo._id },
      {
        userId: user._id,
        tenantId: tenantBravo._id,
        role: 'ADMIN',
        status: 'ACTIVE'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ]);

  await Promise.all([
    TenantModel.updateOne({ _id: tenantAlpha._id }, { $set: { ownerUserId: user._id } }),
    TenantModel.updateOne({ _id: tenantBravo._id }, { $set: { ownerUserId: user._id } })
  ]);

  console.log('Seed completed');
};

seed()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
