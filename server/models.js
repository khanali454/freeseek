import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: String,
  chats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }]
});

const chatSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: { type: String, required: true },
  messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
  role: { type: String, enum: ['user', 'assistant'], required: true }, // 'user' or 'assistant'
  content: String,
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model('User', userSchema);
export const Chat = mongoose.model('Chat', chatSchema);
export const Message = mongoose.model('Message', messageSchema);