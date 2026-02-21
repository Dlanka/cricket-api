import mongoose from "mongoose";
import { connectToDatabase } from "../db/mongo";
import { TenantModel } from "../models/tenant";
import { TournamentModel } from "../models/tournament";
import { TeamModel } from "../models/team";
import { PlayerModel } from "../models/player";

const SEED_CONFIG = {
  tenantName: "Demo Cricket Tenant",
  tournament: {
    name: "Demo Premier League",
    type: "LEAGUE_KNOCKOUT" as const,
    oversPerInnings: 2,
    ballsPerOver: 6,
    status: "DRAFT" as const,
    rules: {
      qualificationCount: 2,
    },
  },
  teams: [
    {
      name: "Colombo Kings",
      shortName: "CK",
      players: [
        "A. Fernando",
        "B. Perera",
        "C. Silva",
        "D. Mendis",
        "E. Gunathilaka",
        "F. Karunaratne",
        "G. Jayasuriya",
        "H. Lakshan",
        "I. Rathnayake",
        "J. Bandara",
        "K. Nissanka",
      ],
    },

    {
      name: "Kandy Riders",
      shortName: "KR",
      players: [
        "L. Samarawickrama",
        "M. Asalanka",
        "N. Shanaka",
        "O. Rajapaksa",
        "P. Hasaranga",
        "Q. Chameera",
        "R. Pathirana",
        "S. Theekshana",
        "T. Kumara",
        "U. Vandersay",
        "V. Madushanka",
      ],
    },

    {
      name: "Galle Titans",
      shortName: "GT",
      players: [
        "W. Janith",
        "X. Nuwan",
        "Y. Vimukthi",
        "Z. Sahan",
        "A1. Kavindu",
        "B1. Minod",
        "C1. Dushmantha",
        "D1. Kusal",
        "E1. Thisara",
        "F1. Isuru",
        "G1. Sadeera",
      ],
    },

    // {
    //   name: "Jaffna Warriors",
    //   shortName: "JW",
    //   players: [
    //     "H1. Avishka",
    //     "I1. Chamika",
    //     "J1. Bhanuka",
    //     "K1. Binura",
    //     "L1. Ashen",
    //     "M1. Praveen",
    //     "N1. Roshen",
    //     "O1. Ramesh",
    //     "P1. Pawan",
    //     "Q1. Tharindu",
    //     "R1. Dilshan",
    //   ],
    // },
    // {
    //   name: "Dambulla Falcons",
    //   shortName: "DF",
    //   players: [
    //     "S1. Charith",
    //     "T1. Niroshan",
    //     "U1. Dasun",
    //     "V1. Lahiru",
    //     "W1. Matheesha",
    //     "X1. Jeffrey",
    //     "Y1. Kasun",
    //     "Z1. Lakmal",
    //     "A2. Nuwanidu",
    //     "B2. Pathum",
    //     "C2. Pramod",
    //   ],
    // },
  ],
};

const run = async () => {
  await connectToDatabase();

  const tenant = await TenantModel.findOneAndUpdate(
    { name: SEED_CONFIG.tenantName },
    { name: SEED_CONFIG.tenantName, status: "ACTIVE" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const tournament = await TournamentModel.findOneAndUpdate(
    { tenantId: tenant._id, name: SEED_CONFIG.tournament.name },
    {
      tenantId: tenant._id,
      ...SEED_CONFIG.tournament,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let teamCount = 0;
  let playerCount = 0;

  for (const teamSeed of SEED_CONFIG.teams) {
    const team = await TeamModel.findOneAndUpdate(
      {
        tenantId: tenant._id,
        tournamentId: tournament._id,
        name: teamSeed.name,
      },
      {
        tenantId: tenant._id,
        tournamentId: tournament._id,
        name: teamSeed.name,
        shortName: teamSeed.shortName,
        sourceType: "TOURNAMENT_TEAM",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    teamCount += 1;

    for (const playerName of teamSeed.players) {
      await PlayerModel.findOneAndUpdate(
        { tenantId: tenant._id, teamId: team._id, fullName: playerName },
        {
          tenantId: tenant._id,
          teamId: team._id,
          fullName: playerName,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      playerCount += 1;
    }
  }

  console.log(
    `Seed completed: tenant=${tenant.name}, tournament=${tournament.name}, teams=${teamCount}, players=${playerCount}`,
  );
};

run()
  .catch((error) => {
    console.error("Tournament bundle seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
