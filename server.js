import express from "express";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import { configDotenv } from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "./lib/auth.js";

configDotenv.apply();

const app = express();
const port = 3000;

const expressServer = app.listen(port, () => {
  console.log("Server is running on port 3000...");
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

const key = new TextEncoder().encode(process.env.SECRET_KEY);

// CORS configuration
// const corsOptions = {
//   origin: "http://localhost:3000",
//   credentials: true,
// };
// app.use(cors(corsOptions));

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "XO",
  password: process.env.DB_PASSWORD,
  port: 5432,
});
db.connect();

//use user"x" to find either socketId or username from "x"
let userSockets = {};
let usernames = {};

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await db.query(`INSERT INTO "USER" VALUES ($1, $2)`, [
      username,
      hashedPassword,
    ]);

    res.status(201).json({ message: "Account created successfully" });
  } catch (err) {
    console.log(err);
    if (err.code === "23505") {
      res.status(409).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Registration failed" });
    }
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const response = await db.query(
      `SELECT * FROM "USER" WHERE "U_Username" = $1`,
      [username]
    );

    if (response.rowCount === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = response.rows[0];
    const isMatch = await bcrypt.compare(password, user.U_Password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = await encrypt({ username });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

const io = new Server(expressServer);

io.on("connection", async (socket) => {
  try {
    const token = socket.handshake.headers.authorization;

    if (!token) {
      throw new Error("Please provide token");
    }

    const decoded = await decrypt(token);
    socket.user = decoded;
    socket.gameId = null;

    console.log(
      `Socket ID ${socket.id} , username ${socket.user.username} connected `
    );
    io.to(socket.id).emit("login", "Connection Success");

    userSockets[socket.id] = socket.user.username;
    usernames[socket.user.username] = socket.id;
  } catch (err) {
    io.to(socket.id).emit("login", err.message);
    socket.disconnect(true);
  }

  socket.on("getPlayers", async () => {
    try {
      const response = await db.query(`SELECT "U_Username" FROM "USER"`);
      const users = response.rows;

      // Map users to include online/offline status
      const players = users.map((user) => ({
        username: user.U_Username,
        status: usernames[user.U_Username] ? "online" : "offline",
      }));

      // Sort players by online first
      players.sort((a, b) =>
        a.status === "online" && b.status === "offline" ? -1 : 1
      );

      // Convert to plain text
      const playersStatus = players
        .map((player) => `${player.username} - ${player.status}`)
        .join("\n");

      io.to(socket.id).emit("reply", playersStatus);
    } catch (err) {
      io.to(socket.id).emit("error", "Internal server error");
    }
  });

  socket.on("invite", async (data) => {
    try {
      const response = await db.query(
        `INSERT INTO "INVITATION" ("INV_Inviter", "INV_Invitee") VALUES (
        $1, $2
      )`,
        [socket.user.username, data.username]
      );

      if (usernames[data.username]) {
        io.to(usernames[data.username]).emit(
          "notification",
          "You have received an invitation from " + socket.user.username
        );
      }
    } catch (err) {
      if (err.code === "23505") {
        io.to(socket.id).emit(
          "error",
          "You've already invited that player. Please wait for their respond."
        );
      }
    }
  });

  socket.on("getInvites", async () => {
    try {
      const response = await db.query(
        `SELECT "INV_Inviter" FROM "INVITATION" WHERE "INV_Invitee" = $1 AND "INV_Status" IS NULL`,
        [socket.user.username]
      );
      const invitations = response.rows
        .map((invite) => `${invite.INV_Inviter}`)
        .join("\n");
      io.to(socket.id).emit("reply", `You have invitations from : \n ${invitations}`)
    } catch (err) {
      io.to(socket.id).emit("error", "Internal server error");
    }
  });
});
