import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

// Create a singleton Prisma client instance
let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Initialize the database connection
export async function initDatabase(): Promise<PrismaClient> {
  try {
    const client = getPrismaClient();
    // Test the connection
    await client.$connect();
    console.log('MongoDB connection established successfully');
    return client;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

// Disconnect from the database (useful for graceful shutdown)
export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    console.log('MongoDB connection closed');
  }
}
