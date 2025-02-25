import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { createStreamingCompletion } from './service/deepseek.js';
import { User, Chat, Message } from './models.js';

const app = express();
app.use(cors());
app.use(express.json());

// Multer Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// Authentication Middleware
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save(); // Ensure `await` is used here
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ email: username });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '3h' });
  res.json({ token });
});

app.post('/chats', authenticate, async (req, res) => {
  try {
    const { title } = req.body;
    const chat = new Chat({ user: req.user._id, title: title || 'New Chat' });
    await chat.save();
    req.user.chats.push(chat._id);
    await req.user.save();
    res.json(chat);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/chats/:chatId/messages', authenticate, upload.single('image'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId).populate('messages');

    if (!chat || !chat.user.equals(req.user._id)) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Create User Message
    let userMessage;
    if (req.file) {
      userMessage = new Message({
        chat: chatId,
        role: 'user',
        content: `/uploads/${req.file.filename}`,
        type: 'image',
      });
    } else {
      const { content } = req.body;
      userMessage = new Message({
        chat: chatId,
        role: 'user',
        content,
      });
    }

    await userMessage.save();
    chat.messages.push(userMessage._id);
    await chat.save();

    // Prepare Chat Context
    const chatContext = chat.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Handle AI Streaming Response
    const stream = await createStreamingCompletion(chatContext);
    let aiResponse = '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      aiResponse += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    // Save AI Response
    const aiMessage = new Message({
      chat: chatId,
      role: 'assistant',
      content: aiResponse,
      type: 'text',
    });

    await aiMessage.save();
    chat.messages.push(aiMessage._id);
    await chat.save();

    res.end();
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Connect to the database and start the server
connectDB().then(() => {
  app.listen(process.env.PORT, () =>
    console.log(`Server running on port ${process.env.PORT}`)
  );
});