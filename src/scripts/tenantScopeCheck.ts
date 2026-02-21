import mongoose from 'mongoose';
import { connectToDatabase } from '../db/mongo';
import { TenantModel } from '../models/tenant';
import { TournamentModel } from '../models/tournament';
import { scopedFindOne } from '../utils/scopedQuery';

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  await connectToDatabase();

  const [tenantA, tenantB] = await Promise.all([
    TenantModel.findOneAndUpdate(
      { name: 'Tenant A' },
      { name: 'Tenant A', status: 'ACTIVE' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    TenantModel.findOneAndUpdate(
      { name: 'Tenant B' },
      { name: 'Tenant B', status: 'ACTIVE' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ]);

  const tournamentB = await TournamentModel.findOneAndUpdate(
    { name: 'Tenant B Cup', tenantId: tenantB._id },
    { name: 'Tenant B Cup', tenantId: tenantB._id },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const forbidden = await scopedFindOne(
    TournamentModel,
    tenantA._id.toString(),
    { _id: tournamentB._id }
  );

  assert(!forbidden, 'Tenant A should not access Tenant B tournaments');

  console.log('Tenant scope check passed');
};

run()
  .catch((error) => {
    console.error('Tenant scope check failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
