import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { createStreamingCompletion } from './service/deepseek.js';
import { User, Chat, Message } from './models.js';
export const maxDuration = 300
const app = express();
app.use(cors());
app.use(express.json());

// File Upload Configuration
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
    await user.save();
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ email: username });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '3h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fixed streaming endpoint with proper cleanup and error handling
app.post('/chats/stream', authenticate, upload.single('image'), async (req, res) => {
  let newChat, userMessage;
  try {
    // Create new chat
    newChat = new Chat({
      user: req.user._id,
      title: req.body.content?.substring(0, 50) || 'New Chat',
    });

    // Create user message
    userMessage = new Message({
      chat: newChat._id,
      role: 'user',
      content: req.file ? `/uploads/${req.file.filename}` : req.body.content,
      type: req.file ? 'image' : 'text',
    });

    // Save initial data
    await newChat.save();
    await userMessage.save();
    newChat.messages.push(userMessage._id);
    await newChat.save();
    req.user.chats.push(newChat._id);
    await req.user.save();

    // Setup streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Immediate flush to establish connection
    res.write(':\n\n');

    // Handle client disconnect
    req.on('close', () => {
      stream.controller?.abort();
    });

    // Get AI response
    const stream = await createStreamingCompletion([{
      role: 'user',
      content: req.body.content
    }]);

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content, chatId: newChat._id })}\n\n`);
    }

    // Final message
    res.write(`event: end\ndata: ${JSON.stringify({ done: true })}\n\n`);

    // Save AI message
    const aiMessage = new Message({
      chat: newChat._id,
      role: 'assistant',
      content: fullResponse,
      type: 'text',
    });
    await aiMessage.save();
    newChat.messages.push(aiMessage._id);
    await newChat.save();

  } catch (error) {
    console.error('Error:', error);
    // Cleanup partial chat if error occurs
    if (newChat?._id) {
      await Chat.deleteOne({ _id: newChat._id });
      await Message.deleteMany({ chat: newChat._id });
      await User.updateOne(
        { _id: req.user._id },
        { $pull: { chats: newChat._id } }
      );
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    res.end();
  }
});

// Improved streaming messages endpoint
app.post('/chats/:chatId/messages', authenticate, async (req, res) => {
  let aiMessage, stream;
  try {
    const { chatId } = req.params;
    const chat = await Chat.findById(chatId);

    if (!chat || !chat.user.equals(req.user._id)) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Save user message
    const userMessage = new Message({
      chat: chatId,
      role: 'user',
      content: req.body.content,
      type: 'text',
    });
    await userMessage.save();
    chat.messages.push(userMessage._id);
    await chat.save();

    // Get message history
    const messages = await Message.find({ chat: chatId })
      .sort({ createdAt: 1 })
      .lean();
    const context = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Setup streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(':\n\n'); 

    // Handle client disconnect
    req.on('close', () => {
      stream?.controller?.abort();
    });

    // Create empty AI message
    aiMessage = new Message({
      chat: chatId,
      role: 'assistant',
      content: '',
      type: 'text',
    });
    await aiMessage.save();

    // Start streaming
    stream = await createStreamingCompletion(context);
    let fullResponse = '';
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      
      // Update incrementally
      aiMessage.content = fullResponse;
      await aiMessage.save();
      
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    // Finalize
    res.write(`event: end\ndata: {}\n\n`);
    chat.messages.push(aiMessage._id);
    await chat.save();

  } catch (error) {
    console.error('Error:', error);
    // Cleanup AI message if error occurs
    if (aiMessage?._id) {
      await Message.deleteOne({ _id: aiMessage._id });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    res.end();
  }
});

// Get all chats
app.get('/chats', authenticate, async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('messages');
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize server
connectDB().then(() => {
  app.listen(process.env.PORT, () => 
    console.log(`Server running on port ${process.env.PORT}`)
  );
});