import express from "express";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import { configDotenv } from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "./lib/auth.js";
import { checkWinner } from "./lib/game.js";
import { getBoard } from "./lib/boardDisplay.js";

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
let games = [];

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
    usernames[socket.user.username] = socket;
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
        io.to(usernames[data.username].id).emit(
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
      io.to(socket.id).emit(
        "reply",
        `You have invitations from : \n ${invitations}`
      );
    } catch (err) {
      io.to(socket.id).emit("error", "Internal server error");
    }
  });

  socket.on("acceptInvite", async (data) => {
    try {
      if (socket.gameId != null) {
        throw new Error("You are currently in a game.");
      } else if (!usernames[data.username]) {
        throw new Error("The other player is not online.");
      } else if (usernames[data.username].gameId != null) {
        throw new Error("The other player is currently in a game.");
      } else {
        const response = await db.query(
          `INSERT INTO "GAME" ("G_PlayerX", "G_PlayerO") VALUES (
            $1, $2) RETURNING "G_Id"`,
          [data.username, socket.user.username]
        );
        const gameId = response.rows[0].G_Id;
        socket.gameId = gameId;
        usernames[data.username].gameId = gameId;
        io.to(usernames[data.username].id).emit("inviteAccepted", { gameId });
        io.to(usernames[data.username].id).emit(
          "notification",
          `Your invitation to ${data.username} is accepted. Game starts!!`
        );
        games[gameId] = {
          board: ["X", "X", null, null, null, null, null, null, null],
          playerX: data.username,
          playerO: socket.user.username,
          turn: "X",
        };
      }
    } catch (err) {
      io.to(socket.id).emit("error", err.message);
    }
  });

  socket.on("inviteAccepted", (data) => {
    socket.gameId = data.gameId;
  });

  socket.on("play", async (data) => {
    console.log(socket.gameId)
    if (socket.gameId === null) {
      io.to(socket.id).emit(
        "error",
        "You are not currently in a game right now"
      );
    } else if (
      (games[socket.gameId].turn === "X" &&
        games[socket.gameId].playerX != socket.user.username) ||
      (games[socket.gameId].turn === "O" &&
        games[socket.gameId].playerO != socket.user.username)
    ) {
      io.to(socket.id).emit("error", "Sorry it's not your turn yet.");
    } else if (data.tile < 1 || data.tile > 9) {
      io.to(socket.id).emit("error", "Please select only 1 - 9");
    } else if (games[socket.gameId].board[data.tile - 1] != null) {
      io.to(socket.id).emit("error", "That tile already occupied.");
    } else {
      games[socket.gameId].board[data.tile - 1] = games[socket.gameId].turn;
      if (games[socket.gameId].turn === "X") {
        games[socket.gameId].turn = "O";
      } else {
        games[socket.gameId].turn = "X";
      }
      //check win
      const result = checkWinner(games[socket.gameId].board);
      if (result === "X" || result === "O") {
        try {
          const resposnse = await db.query(
            `UPDATE "GAME" SET 
            "G_Result" = $1 WHERE "G_Id" = $2`,
            [result, socket.gameId]
          );
          const gameId = socket.gameId;
          io.to(usernames[games[gameId].playerX].id).emit(
            "notification",
            `Player ${result} has won the game!! \n ${getBoard(
              games[gameId].board
            )}`
          );
          io.to(usernames[games[gameId].playerX].id).emit("endgame");
          io.to(usernames[games[gameId].playerO].id).emit(
            "notification",
            `Player ${result} has won the game!! \n ${getBoard(
              games[gameId].board
            )}`
          );
          io.to(usernames[games[gameId].playerO].id).emit("endgame");
          delete games[gameId];
        } catch (err) {
          console.log(err.message);
        }
      } else {
        const board = getBoard(games[socket.gameId].board);
        const nextPlayer =
          games[socket.gameId].turn === "X"
            ? games[socket.gameId].playerX
            : games[socket.gameId].playerO;
        io.to(usernames[nextPlayer].id).emit(
          "notification",
          `Hey. It's your turn to play. The board is : \n ${board}`
        );
      }
    }
  });

  socket.on("showSocket", () => {
    console.log(socket);
  });

  socket.on("endgame", () => {
    socket.gameId = null;
  });
});
