import mongoose from 'mongoose';
import { connectToDatabase } from '../db/mongo';
import { TenantModel } from '../models/tenant';
import { TournamentModel } from '../models/tournament';
import { getTournamentById } from '../services/tournamentService';

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
    { name: 'Tenant B League', tenantId: tenantB._id },
    {
      name: 'Tenant B League',
      tenantId: tenantB._id,
      type: 'LEAGUE',
      oversPerInnings: 20,
      ballsPerOver: 6,
      status: 'ACTIVE'
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  let blocked = false;

  try {
    await getTournamentById(tenantA._id.toString(), tournamentB._id.toString());
  } catch {
    blocked = true;
  }

  assert(blocked, 'Tenant A should not access Tenant B tournaments');

  console.log('Tournament tenant isolation check passed');
};

run()
  .catch((error) => {
    console.error('Tournament tenant isolation check failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
