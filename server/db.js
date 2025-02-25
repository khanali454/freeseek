import mongoose from 'mongoose';
const clientOptions = { serverApi: { version: '1', strict: true, deprecationErrors: true } };

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI,clientOptions);
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection error:', error);
  }
};

export default connectDB;