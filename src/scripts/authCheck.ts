import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { connectToDatabase } from '../db/mongo';
import { UserModel } from '../models/user';
import { TenantModel } from '../models/tenant';
import { MembershipModel } from '../models/membership';
import { loginWithPassword, selectTenantSession } from '../services/authService';

const ensureTenant = async (name: string) =>
  TenantModel.findOneAndUpdate(
    { name },
    { name, status: 'ACTIVE' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const upsertUser = async (email: string, fullName: string, password: string) => {
  const passwordHash = await bcrypt.hash(password, 12);
  return UserModel.findOneAndUpdate(
    { email },
    {
      email,
      fullName,
      passwordHash,
      status: 'ACTIVE'
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const ensureMembership = async (userId: string, tenantId: string, role = 'ADMIN') =>
  MembershipModel.findOneAndUpdate(
    { userId, tenantId },
    { userId, tenantId, role, status: 'ACTIVE' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  await connectToDatabase();

  const [alpha, bravo, charlie] = await Promise.all([
    ensureTenant('Alpha Cricket'),
    ensureTenant('Bravo Cricket'),
    ensureTenant('Charlie Cricket')
  ]);

  const singleUser = await upsertUser('single@cricket.local', 'Single Tenant', 'ChangeMe123!');
  const multiUser = await upsertUser('multi@cricket.local', 'Multi Tenant', 'ChangeMe123!');

  await Promise.all([
    ensureMembership(singleUser._id.toString(), alpha._id.toString(), 'ADMIN'),
    ensureMembership(multiUser._id.toString(), alpha._id.toString(), 'ADMIN'),
    ensureMembership(multiUser._id.toString(), bravo._id.toString(), 'SCORER')
  ]);

  const singleLogin = await loginWithPassword('single@cricket.local', 'ChangeMe123!');
  assert(singleLogin.mode === 'LOGGED_IN', 'Expected LOGGED_IN for single membership');

  const multiLogin = await loginWithPassword('multi@cricket.local', 'ChangeMe123!');
  assert(multiLogin.mode === 'SELECT_TENANT', 'Expected SELECT_TENANT for multi membership');

  if (multiLogin.mode !== 'SELECT_TENANT') {
    throw new Error('Expected SELECT_TENANT for multi membership');
  }

  const selected = await selectTenantSession(multiLogin.loginSessionToken, alpha._id.toString());
  assert(selected.mode === 'LOGGED_IN', 'Expected LOGGED_IN after tenant selection');

  await ensureMembership(multiUser._id.toString(), charlie._id.toString(), 'VIEWER');

  console.log('Auth flow checks passed');
};

run()
  .catch((error) => {
    console.error('Auth flow check failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
