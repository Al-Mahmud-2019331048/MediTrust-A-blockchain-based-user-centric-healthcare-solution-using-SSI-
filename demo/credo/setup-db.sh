#!/bin/bash

# Setup script for MongoDB and Prisma

# Copy .env.example to .env if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file from .env.example..."
  cp .env.example .env
  echo "Please update the .env file with your MongoDB connection string and other settings."
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Check if MongoDB is running
echo "Checking MongoDB connection..."
if npx prisma db push --skip-generate; then
  echo "MongoDB connection successful and schema deployed!"
else
  echo "Error connecting to MongoDB. Please make sure MongoDB is running and your DATABASE_URL is correct in .env"
  exit 1
fi

echo "Setup complete! You can now start the agents."
