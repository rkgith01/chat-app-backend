const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/User");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const path = require("path");
const multer = require("multer");
const ws = require("ws");
const Message = require("./models/Message");
const Image = require("./models/Image");
const fs = require("fs");

dotenv.config();
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error.message);
  });

const jwtSecret = process.env.JWT_SECRET;

const bcryptSalt = bcrypt.genSaltSync(10);

app.use("/uploads", express.static(__dirname + "/uploads"));

app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_PORT,
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.json("hello from Backend");
})

// multer storage for images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/images");
  },
  filename: (req, file, cb) => {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
});

async function getUserData(req) {
  return new Promise((resolve, reject) => {
    const token = req.cookies?.token;
    if (token) {
      jwt.verify(token, jwtSecret, {}, (err, userInfo) => {
        if (err) throw err;
        resolve(userInfo);
      });
    } else {
      reject("No Token");
    }
  });
}

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const userData = await getUserData(req);
    const senderId = userData.id;

    const imageDoc = await Image.create({
      image: req.file.filename,
      sender: senderId,
    });

    res.json(imageDoc);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Add this route for updating user image
app.put("/updateImage", upload.single("file"), async (req, res) => {
  try {
    const userData = await getUserData(req);
    const senderId = userData.id;

    // Find the existing image record for the sender
    const existingImage = await Image.findOne({ sender: senderId });
    if (!existingImage) {
      return res.status(404).json({ error: "Image not found for the user" });
    }

    // Update the image field in the existing record
    existingImage.image = req.file.filename;
    await existingImage.save();

    res.status(200).json({ id: existingImage._id, image: existingImage.image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/getImages", async (req, res) => {
  try {
    const images = await Image.find();
    res.json(images);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// persisting the messages for users
app.get("/messages/:id", async (req, res) => {
  const userId = req.params.id;

  const userData = await getUserData(req);
  const otherUserId = userData.id;
  const messages = await Message.find({
    sender: { $in: [userId, otherUserId] },
    to: { $in: [userId, otherUserId] },
  }).sort({ createdAt: 1 });
  res.json(messages);
});

// showing offline & online users
app.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, { _id: 1, username: 1 });
    // console.log(users)
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// on login page
app.get("/profile", async (req, res) => {
  try {
    const token = req.cookies?.token;

    if (token) {
      jwt.verify(token, jwtSecret, {}, async (err, userInfo) => {
        if (err) throw err;

        // Fetch user data including email
        const { id, username } = userInfo;
        const user = await User.findById(id);

        if (user) {
          const userData = {
            id: user._id,
            username: user.username,
            email: user.email,
          };

          res.json(userData);
        } else {
          res.status(404).json({ error: "User not found" });
        }
      });
    } else {
      res.status(401).json({ error: "No Token" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.put("/updateName", async (req, res) => {
  try {
    const userData = await getUserData(req);
    const { id } = userData;
    const { newUsername } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { username: newUsername },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update shared storage
    userStorage[id] = {
      id,
      username: newUsername,
    };

    // Update the username in the token
    const newToken = jwt.sign(
      {
        id: updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
      },
      jwtSecret,
      { expiresIn: undefined }
    );

    // Set the updated token in the response cookie
    res.cookie("token", newToken, { sameSite: "none", secure: true });

    // Call the function to update user information for connected clients
    [...wss.clients].forEach((client) => {
      if (client.updateUserInformation) {
        console.log(
          "Updating user information for connected client",
          newUsername
        );
        client.updateUserInformation(newUsername);
      }
    });

    res
      .status(200)
      .json({ id: updatedUser._id, username: updatedUser.username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// on sign-in page
// app.post("/login", async (req, res) => {
//   const { username, password } = req.body;
//   const findUser = await User.findOne({ username });
//   console.log("findUser: ", findUser);
//   if (findUser) {
//     const passOk = await bcrypt.compare(password, findUser.password);
//     if (passOk) {
//       jwt.sign(
//         { username, id: findUser._id, email: findUser.email },
//         jwtSecret,
//         {},
//         (err, token) => {
//           if (err) throw err;
//           res
//             .cookie("token", token, { sameSite: "none", secure: true })
//             .status(200)
//             .json({
//               id: findUser._id,
//               username,
//             });
//           console.log("username: ", username);
//         }
//       );
//     }
//   }
// });

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const findUser = await User.findOne({ username });

  if (findUser) {
    const passOk = await bcrypt.compare(password, findUser.password);
    if (passOk) {
      jwt.sign(
        { username, id: findUser._id, email: findUser.email },
        jwtSecret,
        {},
        (err, token) => {
          if (err) throw err;

          // Update shared storage with new username
          userStorage[findUser._id] = {
            id: findUser._id,
            username,
          };

          res
            .cookie("token", token, { sameSite: "none", secure: true })
            .status(200)
            .json({
              id: findUser._id,
              username,
            });

          // Broadcast updated online users to all connected clients
          broadcastOnlineUsers();
        }
      );
    }
  }
});

// app.post("/logout", async (req, res) => {
//   const userData = await getUserData(req);
//   const userId = userData.id;

//   // Terminate the WebSocket connection for the logged-out user
//   const userConnection = [...wss.clients].find((client) => client.id === userId);
//   if (userConnection) {
//     clearInterval(userConnection.timer);
//     userConnection.terminate();
//   }

//   // Remove the user from userStorage
//   delete userStorage[userId];

//   // Broadcast updated online users to all connected clients
//   broadcastOnlineUsers();


//   res
//     .cookie("token", "", { sameSite: "none", secure: true })
//     .status(200)
//     .json("ok");
// });

app.post('/logout', (req, res) => {
  res.cookie('token', '', { sameSite: 'none', secure: true }).status(200).json('ok');
});


app.get("/test", (req, res) => {
  res.json("test Ok");
});

app.post("/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const hashedPassword = await bcrypt.hashSync(password, bcryptSalt);
    const createdUser = await User.create({
      username: username,
      password: hashedPassword,
      email: email,
      image: req.file?.path,
    });

    jwt.sign({ id: createdUser.id, username }, jwtSecret, {}, (err, token) => {
      if (err) {
        return res.status(500).json({ error: "Internal Server Error" });
      }

      res
        .cookie("token", token, { sameSite: "none", secure: true })
        .status(201)
        .json({
          id: createdUser.id,
        });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.delete("/deleteAccount", async (req, res) => {
  try {
    // Wrap the code in a try-catch block to handle errors
    const userData = await getUserData(req);
    const userId = userData.id;

    // Delete user from the database
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Remove the user from userStorage
    delete userStorage[userId];

    // Broadcast updated online users to all connected clients
    broadcastOnlineUsers();

    res
      .cookie("token", "", { sameSite: "none", secure: true })
      .status(200)
      .json({ message: "Account deleted successfully" });
  } catch (error) {
    // Handle the case where getUserData rejects with "No Token"
    if (error === "No Token") {
      return res.status(401).json({ error: "No Token" });
    }

    // Handle other errors
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


const broadcastOnlineUsers = () => {
  const onlineUsersArray = [...wss.clients].map((c) => ({
    id: c.id,
    username: c.username,
  }));

  [...wss.clients].forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(JSON.stringify({ online: onlineUsersArray }));
    }
  });
};

const server = app.listen(3001, () => {
  console.log("server running on port 3001");
});

const wss = new ws.WebSocketServer({ server });
const userStorage = {};

wss.on("connection", (connection, req) => {
  // const alertAboutOnlineusers = () => {
  //   [...wss.clients].forEach((client) => {
  //     client.send(
  //       JSON.stringify({
  //         online: [...wss.clients].map((c) => ({
  //           id: c.id,
  //           username: c.username,
  //         })),
  //       })
  //     );
  //   });
  // }

  // Broadcast online users with updated username

  connection.isAlive = true;

  connection.timer = setInterval(() => {
    connection.ping();
    connection.deathTimer = setTimeout(() => {
      connection.isAlive = false;
      clearInterval(connection.timer);
      connection.terminate();
      // alertAboutOnlineusers()
      broadcastOnlineUsers();
      // console.log("dead");
    }, 1000);
  }, 5000);

  connection.on("pong", () => {
    // connection.isAlive = true
    // console.log("pong")
    clearTimeout(connection.deathTimer);
  });

  connection.on("close", (code, reason) => {
    console.log(`Connection closed with code ${code} and reason: ${reason}`);
    clearInterval(connection.timer);

    // Handle user logout
    if (connection.id) {
      delete userStorage[connection.id];
    }
    connection.isAlive = false;
    wss.clients.delete(connection);
    broadcastOnlineUsers();
  });

  const cookies = req.headers.cookie;
  if (cookies) {
    const tokenString = cookies
      .split(";")
      .map((str) => str.trim()) // Remove extra whitespaces
      .find((str) => str.startsWith("token="));

    if (tokenString) {
      const token = tokenString.split("=")[1];
      if (token) {
        jwt.verify(token, jwtSecret, {}, (err, userInfo) => {
          if (err) throw err;
          const { id, username } = userInfo;
          // Update user information in userStorage
          userStorage[id] = {
            id,
            username,
          };

          const updateUserInformation = (newUsername) => {
            console.log("Updating user information", newUsername);
            userInfo.username = newUsername;
            connection.username = newUsername;
            connection.id = id;

            connection.send(
              JSON.stringify({
                type: "updateUsername",
                id: id,
                username: newUsername,
              })
            );
          };

          connection.username = username;
          connection.id = id;
          connection.updateUserInformation = updateUserInformation;
        });
      }
    }
  }

  connection.on("message", async (message) => {
    const messageData = JSON.parse(message.toString());
    const { to, text, file } = messageData;

    let filename = null;
    if (file) {
      const fileParts = file.name.split(".");
      const ext = fileParts[fileParts.length - 1];
      filename = Date.now() + "." + ext;
      const path = __dirname + "/uploads/" + filename;
      
      let fileData = file.data.split(",")[1];
      
      // console.log(fileData)

      const fileBuffer = Buffer.from(fileData, "base64");

      console.log(fileBuffer)
      fs.writeFile(path, fileBuffer , (err) => {
        console.log("file saved:" + path);
        
      })
        
      
    }

    if (to && (text || file)) {
      const messageDoc = await Message.create({
        sender: connection.id,
        to,
        text,
        file: file ? filename : null,
        createdAt: new Date(),
      });
      [...wss.clients]
        .filter((c) => c.id === to)
        .forEach((c) =>
          c.send(
            JSON.stringify({
              text,
              sender: connection.id,
              to,
              file: file ? filename : null,
              createdAt: new Date(),
              _id: messageDoc._id,
            })
          )
        );
    }
  });

  // Broadcast online users initially
  broadcastOnlineUsers();
});

wss.on("close", (data) => {
  console.log("disconnected", data);
});
