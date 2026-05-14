import express from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import { ExpressPeerServer } from "peer";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  // Setup PeerJS Server
  const peerServer = ExpressPeerServer(server, {
    path: "/",
    allow_discovery: true,
  });

  // Mount PeerJS on /peerjs
  app.use("/peerjs", peerServer);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
