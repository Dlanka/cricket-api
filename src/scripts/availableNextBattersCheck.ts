import mongoose from 'mongoose';
import { connectToDatabase } from '../db/mongo';
import { TenantModel } from '../models/tenant';
import { TournamentModel } from '../models/tournament';
import { TeamModel } from '../models/team';
import { PlayerModel } from '../models/player';
import { MatchModel } from '../models/match';
import { MatchPlayerModel } from '../models/matchPlayer';
import { InningsModel } from '../models/innings';
import { InningsBatterModel } from '../models/inningsBatter';
import { getAvailableNextBatters } from '../services/matchService';

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  await connectToDatabase();

  const tenant = await TenantModel.findOneAndUpdate(
    { name: 'Available Next Batters Tenant' },
    { name: 'Available Next Batters Tenant', status: 'ACTIVE' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const tournament = await TournamentModel.findOneAndUpdate(
    { tenantId: tenant._id, name: 'Available Next Batters Cup' },
    {
      tenantId: tenant._id,
      name: 'Available Next Batters Cup',
      type: 'LEAGUE',
      oversPerInnings: 20,
      ballsPerOver: 6,
      status: 'ACTIVE'
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const [battingTeam, bowlingTeam] = await Promise.all([
    TeamModel.findOneAndUpdate(
      { tenantId: tenant._id, tournamentId: tournament._id, name: 'Check Batting XI' },
      { tenantId: tenant._id, tournamentId: tournament._id, name: 'Check Batting XI', sourceType: 'TOURNAMENT_TEAM' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    TeamModel.findOneAndUpdate(
      { tenantId: tenant._id, tournamentId: tournament._id, name: 'Check Bowling XI' },
      { tenantId: tenant._id, tournamentId: tournament._id, name: 'Check Bowling XI', sourceType: 'TOURNAMENT_TEAM' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ]);

  const battingPlayers = await Promise.all(
    ['A One', 'A Two', 'A Three', 'A Four', 'A Five'].map((fullName) =>
      PlayerModel.findOneAndUpdate(
        { tenantId: tenant._id, teamId: battingTeam._id, fullName },
        { tenantId: tenant._id, teamId: battingTeam._id, fullName },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    )
  );

  const bowler = await PlayerModel.findOneAndUpdate(
    { tenantId: tenant._id, teamId: bowlingTeam._id, fullName: 'B One' },
    { tenantId: tenant._id, teamId: bowlingTeam._id, fullName: 'B One' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const match = await MatchModel.findOneAndUpdate(
    { tenantId: tenant._id, tournamentId: tournament._id, teamAId: battingTeam._id, teamBId: bowlingTeam._id, stage: 'LEAGUE' },
    {
      tenantId: tenant._id,
      tournamentId: tournament._id,
      teamAId: battingTeam._id,
      teamBId: bowlingTeam._id,
      stage: 'LEAGUE',
      status: 'LIVE'
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const innings = await InningsModel.findOneAndUpdate(
    { tenantId: tenant._id, matchId: match._id, inningsNumber: 1 },
    {
      tenantId: tenant._id,
      matchId: match._id,
      inningsNumber: 1,
      battingTeamId: battingTeam._id,
      bowlingTeamId: bowlingTeam._id,
      strikerId: battingPlayers[0]._id,
      nonStrikerId: battingPlayers[1]._id,
      currentBowlerId: bowler._id,
      runs: 10,
      wickets: 1,
      balls: 12,
      ballsPerOver: 6,
      oversPerInnings: 20,
      status: 'LIVE'
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  match.currentInningsId = innings._id;
  match.status = 'LIVE';
  await match.save();

  await MatchPlayerModel.deleteMany({ tenantId: tenant._id, matchId: match._id });
  await MatchPlayerModel.insertMany([
    ...battingPlayers.map((player) => ({
      tenantId: tenant._id,
      matchId: match._id,
      teamId: battingTeam._id,
      playerId: player._id,
      isPlaying: true
    })),
    {
      tenantId: tenant._id,
      matchId: match._id,
      teamId: bowlingTeam._id,
      playerId: bowler._id,
      isPlaying: true
    }
  ]);

  await InningsBatterModel.deleteMany({ tenantId: tenant._id, inningsId: innings._id });
  await InningsBatterModel.insertMany([
    {
      tenantId: tenant._id,
      inningsId: innings._id,
      playerRef: { playerId: battingPlayers[0]._id, name: battingPlayers[0].fullName },
      batterKey: { playerId: battingPlayers[0]._id, name: battingPlayers[0].fullName },
      runs: 12,
      balls: 10,
      isOut: false
    },
    {
      tenantId: tenant._id,
      inningsId: innings._id,
      playerRef: { playerId: battingPlayers[1]._id, name: battingPlayers[1].fullName },
      batterKey: { playerId: battingPlayers[1]._id, name: battingPlayers[1].fullName },
      runs: 8,
      balls: 9,
      isOut: false
    },
    {
      tenantId: tenant._id,
      inningsId: innings._id,
      playerRef: { playerId: battingPlayers[2]._id, name: battingPlayers[2].fullName },
      batterKey: { playerId: battingPlayers[2]._id, name: battingPlayers[2].fullName },
      runs: 0,
      balls: 1,
      isOut: true,
      outKind: 'bowled'
    },
    {
      tenantId: tenant._id,
      inningsId: innings._id,
      playerRef: { playerId: battingPlayers[3]._id, name: battingPlayers[3].fullName },
      batterKey: { playerId: battingPlayers[3]._id, name: battingPlayers[3].fullName },
      runs: 4,
      balls: 3,
      isOut: true,
      outKind: 'retired'
    }
  ]);

  const resultOne = await getAvailableNextBatters(tenant._id.toString(), match._id.toString());
  const optionIdsOne = resultOne.items.map((item) => item.playerId);

  assert(!optionIdsOne.includes(resultOne.strikerId), 'Should not include current striker');
  assert(!optionIdsOne.includes(resultOne.nonStrikerId), 'Should not include current non-striker');
  assert(!optionIdsOne.includes(battingPlayers[2]._id.toString()), 'Should not include dismissed batter');
  assert(!optionIdsOne.includes(battingPlayers[3]._id.toString()), 'Should not include retired batter');
  assert(optionIdsOne.includes(battingPlayers[4]._id.toString()), 'Should include eligible incoming batter');

  const resultTwo = await getAvailableNextBatters(tenant._id.toString(), match._id.toString());
  assert(
    JSON.stringify(resultOne.items) === JSON.stringify(resultTwo.items),
    'Should return deterministic options for identical match state'
  );

  console.log('Available next batters checks passed');
};

run()
  .catch((error) => {
    console.error('Available next batters checks failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });

