// MongoDB connection — always connects to the cloud (MongoDB Atlas) URI
// supplied via MONGODB_URI. Set it in server/.env (see server/.env.example).
import mongoose from "mongoose";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy server/.env.example to server/.env and fill in " +
      "your MongoDB Atlas connection string."
    );
  }
  await mongoose.connect(uri, { dbName: "seizureguard", serverSelectionTimeoutMS: 15000 });
  console.log("[db] Connected to MongoDB Atlas");
}
