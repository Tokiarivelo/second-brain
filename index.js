const express = require("express"); 
const { PrismaClient } = require("./generated/prisma_client"); 
const { PrismaPg } = require("@prisma/adapter-pg"); 
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL, 
}); 
const app = express(); 
const prisma = new PrismaClient({
  adapter, 
}); 
app.use(express.json()); 
// Get all users
app.get("/", async (req, res) => {
  const userCount = await prisma.user.count(); 
  res.json(
    userCount == 0
      ? "No users have been added yet."
      : "Some users have been added to the database.", 
  ); 
}); 
const PORT = 3000; 
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`); 
}); 