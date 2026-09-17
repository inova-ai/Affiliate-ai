import express from "express";
import app from "./server/index.js";

// Express is intentionally imported at the root so Vercel detects this as the Node.js/Express entrypoint.
void express;
export default app;
