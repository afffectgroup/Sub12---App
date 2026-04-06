import express from "express";
const app = express();
app.get("/api/env", (req, res) => {
  res.json({
    APP_URL: process.env.APP_URL,
    SHARED_APP_URL: process.env.SHARED_APP_URL,
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV
  });
});
app.listen(3001, "0.0.0.0", () => {
  console.log("Env checker running on 3001");
});
