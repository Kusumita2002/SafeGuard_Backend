const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const PORT = 5000;

// ------------ express + http + socket.io ------------
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH"],
  },
});

// ------------ ensure uploads folder ------------
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ------------ middleware ------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));

// ------------ socket connection ------------
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
});

// ------------ in-memory "DB" ------------
const users = [];
const lastLocationByEmail = new Map();

const sosEvents = [];
const locationEvents = [];
const messageEvents = [];
const feedbackEvents = [];
const activityEvents = [];

// ------------ helper ------------
function logActivity({ userId, type, details }) {
  const evt = {
    id: Date.now().toString(),
    userId,
    type,
    details: details || {},
    createdAt: new Date(),
  };

  activityEvents.unshift(evt);
  if (activityEvents.length > 500) activityEvents.length = 500;

  io.emit("activity:new", evt);
}

// ------------ multer for file uploads ------------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName =
      file.fieldname +
      "_" +
      Date.now() +
      (path.extname(file.originalname) || "");
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ------------ auth routes ------------
app.post("/api/signup", (req, res) => {
  const { name, email, password, phone, emergencyContacts } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Name, email and password are required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const exists = users.find((u) => u.email === normalizedEmail);
  if (exists) {
    return res.status(400).json({
      success: false,
      message: "User already exists.",
    });
  }

  const trimmedPhone = (phone || "").trim();
  if (trimmedPhone) {
    const existingPhoneUser = users.find((u) => u.phone === trimmedPhone);
    if (existingPhoneUser) {
      return res.status(400).json({
        success: false,
        message: "This phone number is already registered.",
      });
    }
  }

  const user = {
    id: Date.now().toString(),
    name: name.trim(),
    email: normalizedEmail,
    password: password.trim(),
    phone: trimmedPhone,
    emergencyContacts: Array.isArray(emergencyContacts)
      ? emergencyContacts
      : [],
    createdAt: new Date(),
  };

  users.push(user);
  console.log("Current users after signup:", users);

  return res.json({
    success: true,
    message: "Signup successful.",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      emergencyContacts: user.emergencyContacts,
    },
  });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  console.log("Login attempt:", normalizedEmail);
  console.log("Current users:", users);

  const user = users.find(
    (u) => u.email === normalizedEmail && u.password === password
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password.",
    });
  }

  return res.json({
    success: true,
    message: "Login successful.",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      emergencyContacts: user.emergencyContacts,
    },
  });
});

// ------------ simple SOS / location / messaging ------------
app.post("/api/sos", (req, res) => {
  const { email, message, latitude, longitude } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date();
  const user = users.find((u) => u.email === normalizedEmail);

  const event = {
    id: Date.now().toString(),
    triggeredAt: now,
    userProfile: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          emergencyContacts: user.emergencyContacts,
        }
      : {
          id: null,
          name: null,
          email: normalizedEmail,
          phone: null,
          emergencyContacts: [],
        },
    location:
      latitude != null && longitude != null
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : null,
    media: {
      photoUrl: null,
      videoUrl: null,
      audioUrl: null,
    },
    message: message || "Voice SOS triggered",
    status: "pending",
    assignedTo: null,
  };

  sosEvents.unshift(event);
  console.log("Voice SOS:", event);

  logActivity({
    userId: normalizedEmail,
    type: "voice_sos",
    details: {
      message: event.message,
      location: event.location,
    },
  });

  io.emit("sos:new", event);

  return res.json({
    success: true,
    message: "Voice SOS triggered.",
    event,
  });
});

app.post("/api/share-location-once", (req, res) => {
  const { email, latitude, longitude } = req.body || {};

  if (!email || latitude == null || longitude == null) {
    return res.status(400).json({
      success: false,
      message: "Email, latitude and longitude are required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date();

  lastLocationByEmail.set(normalizedEmail, {
    latitude: Number(latitude),
    longitude: Number(longitude),
    time: now,
  });

  const evt = {
    id: Date.now().toString(),
    email: normalizedEmail,
    latitude: Number(latitude),
    longitude: Number(longitude),
    time: now,
  };

  locationEvents.unshift(evt);

  logActivity({
    userId: normalizedEmail,
    type: "gps",
    details: {
      latitude: Number(latitude),
      longitude: Number(longitude),
    },
  });

  io.emit("gps:new", evt);

  return res.json({
    success: true,
    message: "Location shared.",
    location: evt,
  });
});

app.post("/api/stop-location", (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  return res.json({
    success: true,
    message: "Location sharing stopped.",
    email: normalizedEmail,
  });
});

app.post("/api/send-emergency-message", (req, res) => {
  const { email, type, customText } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find((u) => u.email === normalizedEmail);
  const contacts = user?.emergencyContacts || [];

  let text;
  if (type === "danger") {
    text = "I am in danger, please help immediately.";
  } else if (type === "track") {
    text = "Please track my live location right now.";
  } else if (type === "custom") {
    text = customText || "Emergency – please help.";
  } else {
    text = "Emergency alert from SafeGuard user.";
  }

  const evt = {
    id: Date.now().toString(),
    email: normalizedEmail,
    type: type || "default",
    text,
    contacts,
    time: new Date(),
  };

  messageEvents.unshift(evt);

  console.log(
    "Emergency message from",
    normalizedEmail,
    "to",
    contacts,
    "text:",
    text
  );

  logActivity({
    userId: normalizedEmail,
    type: "message",
    details: { text, type: type || "default" },
  });

  io.emit("message:new", evt);

  return res.json({
    success: true,
    message: "Emergency message queued.",
    event: evt,
  });
});

// ------------ full emergency SOS with media + GPS ------------
app.post(
  "/api/emergency-sos",
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      const { email, latitude, longitude } = req.body || {};

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const photo = req.files?.photo?.[0] || null;
      const video = req.files?.video?.[0] || null;
      const audio = req.files?.audio?.[0] || null;

      const now = new Date();
      const user = users.find((u) => u.email === normalizedEmail);

      const filesInfo = {
        photoUrl: photo ? `/uploads/${photo.filename}` : null,
        videoUrl: video ? `/uploads/${video.filename}` : null,
        audioUrl: audio ? `/uploads/${audio.filename}` : null,
      };

      const event = {
        id: Date.now().toString(),
        triggeredAt: now,
        userProfile: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              emergencyContacts: user.emergencyContacts,
            }
          : {
              id: null,
              name: null,
              email: normalizedEmail,
              phone: null,
              emergencyContacts: [],
            },
        location:
          latitude != null && longitude != null
            ? { latitude: Number(latitude), longitude: Number(longitude) }
            : null,
        media: filesInfo,
        message: "Emergency SOS with media",
        status: "pending",
        assignedTo: null,
      };

      sosEvents.unshift(event);
      console.log("Stored emergency SOS event:", event);

      logActivity({
        userId: normalizedEmail,
        type: "sos",
        details: {
          location: event.location,
          media: filesInfo,
          message: event.message,
        },
      });

      io.emit("sos:new", event);

      return res.json({
        success: true,
        message: "Emergency SOS received.",
        media: filesInfo,
        event,
      });
    } catch (err) {
      console.error("Error in /api/emergency-sos", err);
      return res.status(500).json({
        success: false,
        message: "Server error while processing emergency SOS.",
      });
    }
  }
);

// ------------ AI assistant help ------------
app.post("/api/ai-assistant-help", (req, res) => {
  const { email, message } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required for AI assistant.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const guidance = message || "AI assistant guidance started";

  logActivity({
    userId: normalizedEmail,
    type: "ai_assistant",
    details: {
      message: guidance,
    },
  });

  return res.json({
    success: true,
    message: "AI assistant event logged for authority.",
  });
});

// ------------ feedback ------------
app.post("/api/feedback", (req, res) => {
  const { name, email, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({
      success: false,
      message: "All fields required.",
    });
  }

  const evt = {
    id: Date.now().toString(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    message: message.trim(),
    time: new Date(),
  };

  feedbackEvents.unshift(evt);

  console.log("Feedback from", name, email, "message:", message);

  return res.json({
    success: true,
    message: "Feedback received. Thank you!",
    feedback: evt,
  });
});

// ------------ admin / authority GET APIs ------------
app.get("/api/admin/sos", (req, res) => {
  res.json(sosEvents.slice(0, 50));
});

app.get("/api/admin/locations", (req, res) => {
  res.json(locationEvents.slice(0, 50));
});

app.get("/api/admin/messages", (req, res) => {
  res.json(messageEvents.slice(0, 50));
});

app.get("/api/admin/feedback", (req, res) => {
  res.json(feedbackEvents.slice(0, 50));
});

app.get("/api/authority/activity", (req, res) => {
  const limit = parseInt(req.query.limit || "200", 10);
  res.json(activityEvents.slice(0, limit));
});

// ------------ claim SOS and update status ------------
app.post("/api/admin/sos/:id/claim", (req, res) => {
  const { authorityId } = req.body || {};
  const id = req.params.id;

  const sos = sosEvents.find((e) => e.id === id);
  if (!sos) {
    return res.status(404).json({
      success: false,
      message: "SOS not found",
    });
  }

  if (!sos.assignedTo) {
    sos.assignedTo = authorityId || "unknown";
    sos.status = "in_progress";
  }

  io.emit("sos:update", sos);

  return res.json({
    success: true,
    sos,
  });
});

app.post("/api/admin/sos/:id/status", (req, res) => {
  const { status } = req.body || {};
  const id = req.params.id;

  const sos = sosEvents.find((e) => e.id === id);
  if (!sos) {
    return res.status(404).json({
      success: false,
      message: "SOS not found",
    });
  }

  sos.status = status || sos.status;

  io.emit("sos:update", sos);

  return res.json({
    success: true,
    sos,
  });
});

// ------------ health check ------------
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "SafeGuard backend running successfully",
    port: PORT,
  });
});

// ------------ start server ------------
server.listen(PORT, () => {
  console.log(`SafeGuard backend running on http://localhost:${PORT}`);
});

module.exports = { app, server, io };