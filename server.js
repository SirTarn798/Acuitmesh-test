import express from "express";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import { configDotenv } from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "./lib/auth.js";
import { checkWinner } from "./lib/game.js";
import { getBoard } from "./lib/boardDisplay.js";
import { getBestMove } from "./lib/aiLogic.js";

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
      //In case of there's a invitation ongoing
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
      //handle unsupported scenarioes
      if (socket.gameId != null) {
        throw new Error("You are currently in a game.");
      } else if (!usernames[data.username]) {
        throw new Error("The other player is not online.");
      } else if (usernames[data.username].gameId != null) {
        throw new Error("The other player is currently in a game.");
      } else {
        let response = await db.query(
          `SELECT * FROM "INVITATION" WHERE "INV_Invitee" = $1 AND "INV_Inviter" = $2 AND "INV_Status" IS NULL`,
          [socket.user.username, data.username]
        );
        const invite = response.rows[0];
        //update invitation
        if (invite) {
          await db.query(
            `UPDATE "INVITATION" SET "INV_Status" = true WHERE "INV_Id" = $1`,
            [invite.INV_Id]
          );

          //set up the match
          response = await db.query(
            `INSERT INTO "GAME" ("G_PlayerX", "G_PlayerO") VALUES (
            $1, $2) RETURNING "G_Id"`,
            [socket.user.username, data.username]
          );
          const gameId = response.rows[0].G_Id;
          socket.gameId = gameId;
          usernames[data.username].gameId = gameId;
          io.to(usernames[data.username].id).emit(
            "notification",
            `Your invitation to ${data.username} is accepted. Game starts!!`
          );
          games[gameId] = {
            board: [null, null, null, null, null, null, null, null, null],
            playerX: socket.user.username,
            playerO: data.username,
            turn: "X",
          };
        } else {
          io.to(socket.id).emit(
            "error",
            "You don't have an active invitation from that player."
          );
        }
      }
    } catch (err) {
      io.to(socket.id).emit("error", err.message);
    }
  });

  socket.on("play", async (data) => {
    //handle unsupported scenarioes
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
      //change tile
      games[socket.gameId].board[data.tile - 1] = games[socket.gameId].turn;
      if (games[socket.gameId].turn === "X") {
        games[socket.gameId].turn = "O";
      } else {
        games[socket.gameId].turn = "X";
      }

      //check win
      const result = checkWinner(games[socket.gameId].board);
      if (result === "X" || result === "O" || result === "Draw") {
        try {
          const resposnse = await db.query(
            `UPDATE "GAME" SET 
            "G_Result" = $1 WHERE "G_Id" = $2`,
            [result, socket.gameId]
          );
          const gameId = socket.gameId;

          if (!games[socket.gameId].bot) {
            io.to(usernames[games[gameId].playerX].id).emit(
              "notification",
              result === "Draw"
                ? `The game result in a Draw!!`
                : `Player ${result} has won the game!! \n ${getBoard(
                    games[gameId].board
                  )}`
            );
          }
          io.to(usernames[games[gameId].playerO].id).emit(
            "notification",
            result === "Draw"
              ? `The game result in a Draw!!`
              : `Player ${result} has won the game!! \n ${getBoard(
                  games[gameId].board
                )}`
          );
          socket.gameId = null;
          if (!games[gameId].bot) {
            usernames[games[gameId].playerX].gameId = null;
          }
          usernames[games[gameId].playerO].gameId = null;

          delete games[gameId];
        } catch (err) {
          console.log(err.message);
        }
      } else {
        //Game continues
        //If playing vs bot
        if (games[socket.gameId].bot) {
          const move = getBestMove(games[socket.gameId].board); // Bot's move
          games[socket.gameId].board[move] = "X"; // Update the board with the bot's move
          games[socket.gameId].turn = "O";
          const botWinCheck = checkWinner(games[socket.gameId].board); // Check if the bot won
          if (
            botWinCheck === "X" ||
            botWinCheck === "O" ||
            botWinCheck === "Draw"
          ) {
            try {
              const response = await db.query(
                `UPDATE "GAME" SET "G_Result" = $1 WHERE "G_Id" = $2`,
                [botWinCheck, socket.gameId]
              );

              const gameId = socket.gameId;

              // Notify the player about the game's result
              io.to(socket.id).emit(
                "notification",
                botWinCheck === "Draw"
                  ? `The game resulted in a Draw! The final board is: \n ${getBoard(
                      games[gameId].board
                    )}`
                  : `The bot has won the game! The final board is: \n ${getBoard(
                      games[gameId].board
                    )}`
              );

              // Clean up game state
              socket.gameId = null;
              delete games[gameId];
              return;
            } catch (err) {
              console.log(err.message);
            }
          }
        }
        // Game continues, notify the player
        const board = getBoard(games[socket.gameId].board);
        if (games[socket.gameId].bot) {
          io.to(socket.id).emit(
            "notification",
            `Hey. It's your turn to play. The board is : \n ${board}`
          );
        } else {
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
    }
  });

  socket.on("getHistory", async () => {
    try {
      const response = await db.query(
        `SELECT * FROM "GAME" WHERE "G_PlayerX" = $1 OR "G_PlayerO" = $1`,
        [socket.user.username]
      );

      //format this result
      const formattedHistory = response.rows.map((game) => {
        const isPlayerX = game.G_PlayerX === socket.user.username;
        const opponent = isPlayerX ? game.G_PlayerO : game.G_PlayerX;

        let result;
        if (game.G_Result === null) {
          result = "Game in progress";
        } else if (game.G_Result === "Draw") {
          result = "draw";
        } else if (
          (game.G_Result === "X" && isPlayerX) ||
          (game.G_Result === "O" && !isPlayerX)
        ) {
          result = "win";
        } else {
          result = "lose";
        }

        return `${opponent} - ${result}`;
      });

      io.to(socket.id).emit("reply", formattedHistory);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("disconnect", async () => {
    try {
      // Check if the user was in an ongoing game
      if (socket.gameId !== null) {
        const gameId = socket.gameId;
        const game = games[gameId];

        // Determine the result based on the disconnecting player
        const result = game.playerX === socket.user.username ? "O" : "X";

        // Update game result in the database
        await db.query(`UPDATE "GAME" SET "G_Result" = $1 WHERE "G_Id" = $2`, [
          result,
          gameId,
        ]);

        // Notify the other player about the win
        const otherPlayer = result === "X" ? game.playerX : game.playerO;
        if (usernames[otherPlayer]) {
          io.to(usernames[otherPlayer].id).emit(
            "notification",
            `${socket.user.username} disconnected. You win the game!`
          );
        }

        // Clean up game state
        delete games[gameId];

        // Reset game IDs for both players
        if (usernames[game.playerX]) {
          usernames[game.playerX].gameId = null;
        }
        if (usernames[game.playerO]) {
          usernames[game.playerO].gameId = null;
        }
      }

      // Remove user from tracking objects
      delete userSockets[socket.id];
      delete usernames[socket.user.username];
    } catch (err) {
      console.error("Disconnect handler error:", err);
    }
  });

  socket.on("playWithBot", async () => {
    try {
      //handle unsupported scenarioes
      if (socket.gameId != null) {
        throw new Error("You are currently in a game.");
      } else {
        //set up the match
        const response = await db.query(
          `INSERT INTO "GAME" ("G_PlayerX", "G_PlayerO") VALUES (
            $1, $2) RETURNING "G_Id"`,
          [socket.user.username, "XO-BOT"]
        );
        const gameId = response.rows[0].G_Id;
        socket.gameId = gameId;
        games[gameId] = {
          board: [null, null, null, null, null, null, null, null, null],
          playerX: "XO-BOT",
          playerO: socket.user.username,
          turn: "O",
          bot: true,
        };
        const move = getBestMove(games[gameId].board);
        games[gameId].board[move] = "X";
        io.to(socket.id).emit(
          "notification",
          `The game has started and the bot has made a move. The board is \n ${getBoard(
            games[gameId].board
          )}`
        );
      }
    } catch (err) {
      io.to(socket.id).emit("error", err.message);
    }
  });

  //debigging purposes
  socket.on("showSocket", () => {
    console.log(socket);
  });
});
