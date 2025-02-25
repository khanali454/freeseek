import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeRaw from 'rehype-raw';

const FreeSeek = () => {
  const [chats, setChats] = useState(() => {
    const savedChats = localStorage.getItem('freeSeekChats');
    return savedChats ? JSON.parse(savedChats) : [];
  });
  
  const [activeChatId, setActiveChatId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Load initial chats from localStorage
  useEffect(() => {
    const savedChats = localStorage.getItem('freeSeekChats');
    if (savedChats) {
      setChats(JSON.parse(savedChats));
      setActiveChatId(JSON.parse(savedChats)[0]?.id || null);
    }
  }, []);

  // Save chats to localStorage
  useEffect(() => {
    localStorage.setItem('freeSeekChats', JSON.stringify(chats));
  }, [chats]);

  const MarkdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          className="rounded-lg p-4 my-2"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className="bg-gray-100 px-2 py-1 rounded" {...props}>
          {children}
        </code>
      );
    },
    img: ({ node, ...props }) => (
      <img {...props} className="max-w-full h-auto rounded-lg my-2" alt="content" />
    ),
    a: ({ node, ...props }) => (
      <a {...props} className="text-purple-600 hover:underline" target="_blank" rel="noreferrer" />
    ),
    think: ({node, ...props}) => (
    <div className="text-gray-500 text-sm border-l-2 border-gray-300 pl-2 my-2">
      {props.children}
    </div>
  )
  };

  const handleStreamRequest = async (message, chatId) => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let result = '';

      const tempMessageId = Date.now();
      setChats(prev => prev.map(chat => 
        chat.id === chatId ? {
          ...chat,
          messages: [...chat.messages, { 
            id: tempMessageId, 
            text: '', 
            isBot: true,
            isStreaming: true
          }]
        } : chat
      ));

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        result += decoder.decode(value, { stream: true });
        
        setChats(prev => prev.map(chat => 
          chat.id === chatId ? {
            ...chat,
            messages: chat.messages.map(msg => 
              msg.id === tempMessageId ? { ...msg, text: result } : msg
            )
          } : chat
        ));
      }

      setChats(prev => prev.map(chat => 
        chat.id === chatId ? {
          ...chat,
          messages: chat.messages.map(msg => 
            msg.id === tempMessageId ? { ...msg, isStreaming: false } : msg
          )
        } : chat
      ));

    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !activeChatId) return;

    const userMessage = {
      id: Date.now(),
      text: newMessage,
      isBot: false,
      timestamp: new Date().toISOString()
    };

    const updatedChats = chats.map(chat => 
      chat.id === activeChatId ? {
        ...chat,
        messages: [...chat.messages, userMessage]
      } : chat
    );

    setChats(updatedChats);
    setNewMessage('');
    await handleStreamRequest(newMessage, activeChatId);
  };

  const handleImageUpload = (file) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const imageMessage = {
        id: Date.now(),
        content: reader.result,
        isImage: true,
        isBot: false,
        timestamp: new Date().toISOString()
      };

      setChats(prev => prev.map(chat => 
        chat.id === activeChatId ? {
          ...chat,
          messages: [...chat.messages, imageMessage]
        } : chat
      ));
    };
    reader.readAsDataURL(file);
  };

  const createNewChat = () => {
    const newChat = {
      id: Date.now(),
      title: `Chat ${chats.length + 1}`,
      messages: [],
      timestamp: new Date().toISOString()
    };
    
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  };

  const activeChat = chats.find(chat => chat.id === activeChatId);

  return (
    <div className="flex h-screen bg-gradient-to-br from-purple-50 to-indigo-50">
      {/* Left Sidebar */}
      <div className="w-64 bg-white shadow-xl flex flex-col border-r border-purple-200">
        <div className="p-4 border-b border-purple-200">
          <button 
            onClick={createNewChat}
            className="w-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-xl py-3 px-4 
              hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg
              flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
            </svg>
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-purple-200 scrollbar-track-gray-50">
          {chats.map((chat) => (
            <div 
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              className={`group px-4 py-3 hover:bg-purple-50 cursor-pointer transition-colors
                border-b border-purple-100 ${activeChatId === chat.id ? 
                  'bg-purple-50 border-l-4 border-purple-500' : ''}`}
            >
              <div className={`text-gray-700 truncate font-medium ${
                activeChatId === chat.id ? 'text-purple-900' : ''}`}>
                {chat.title}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(chat.timestamp).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto border-t border-purple-200 p-4 bg-gray-50/50">
          <button className="flex items-center w-full text-gray-600 hover:text-purple-600 
            hover:bg-white p-2.5 rounded-xl transition-all duration-200 group font-medium">
            <span className="mr-3 ml-1 group-hover:scale-110 transition-transform">
              👤
            </span>
            My Profile
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="border-b border-purple-200 p-4 flex items-center justify-between bg-white/80 backdrop-blur-sm">
          <div className="text-2xl font-bold text-purple-900 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
            </svg>
            FreeSeek
          </div>
          <div className="bg-purple-100 px-4 py-1.5 rounded-full text-sm font-medium text-purple-800">
            DeepThink (R1)
          </div>
        </div>

        {/* <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          <div className="max-w-3xl w-full mx-auto space-y-4">
            {activeChat?.messages?.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.isBot ? 'items-start' : 'justify-end'} gap-4`}
              >
                {message.isBot && (
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl 
                    flex items-center justify-center text-white shadow-md">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 16h-2v-2h2v2zm2.1-5.37l-.71.71c-.2.2-.51.2-.71 0l-.71-.71c-.2-.2-.2-.51 0-.71l1.41-1.41c.2-.2.51-.2.71 0l1.41 1.41c.2.2.2.51 0 .71l-.71.71zM18 10h-2V8h2v2z"/>
                    </svg>
                  </div>
                )}
                
                <div className={`max-w-[80%] rounded-2xl p-4 ${
                  message.isBot 
                    ? 'bg-white border border-gray-100' 
                    : 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white'
                } ${message.isStreaming ? 'animate-pulse' : ''}`}>
                  {message.isImage ? (
                    <img 
                      src={message.content} 
                      className="max-w-full h-auto rounded-lg"
                      alt="User content"
                    />
                  ) : (
                    <div className={message.isBot ? 'text-gray-700' : 'text-white'}>
                      <ReactMarkdown
                        components={MarkdownComponents}
                        remarkPlugins={[remarkGfm]}
                      >
                        {message.text}
                      </ReactMarkdown>
                      {message.isStreaming && <span className="ml-2 animate-blink">...</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div> */}

<div className="flex-1 flex flex-col p-4 overflow-y-auto">
  <div className="max-w-3xl w-full mx-auto space-y-4">
    {activeChat?.messages?.map((message) => (
      <div
        key={message.id}
        className={`flex ${message.isBot ? 'items-start' : 'justify-end'} gap-4`}
      >
        {message.isBot && (
          <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl 
            flex items-center justify-center text-white shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 16h-2v-2h2v2zm2.1-5.37l-.71.71c-.2.2-.51.2-.71 0l-.71-.71c-.2-.2-.2-.51 0-.71l1.41-1.41c.2-.2.51-.2.71 0l1.41 1.41c.2.2.2.51 0 .71l-.71.71zM18 10h-2V8h2v2z"/>
            </svg>
          </div>
        )}
        
        <div className={`max-w-[80%] rounded-2xl p-4 ${
          message.isBot 
            ? 'bg-white border border-gray-100' 
            : 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white'
        } ${message.isStreaming ? 'animate-pulse' : ''}`}>
          {message.isImage ? (
            <img 
              src={message.content} 
              className="max-w-full h-auto rounded-lg"
              alt="User content"
            />
          ) : (
            <div className={message.isBot ? 'text-gray-700' : 'text-white'}>
              <ReactMarkdown
                components={{
                  ...MarkdownComponents,
                  think: ({node, ...props}) => (
                    <div className="text-gray-500 text-sm border-l-2 border-gray-300 pl-2 my-2">
                      {props.children}
                    </div>
                  ),
                  // Add HTML tag processing
                  div: ({node, ...props}) => {
                    if (props.className === 'think') {
                      return (
                        <div className="text-gray-500 text-sm border-l-2 border-gray-300 pl-2 my-2">
                          {props.children}
                        </div>
                      )
                    }
                    return <div {...props} />
                  }
                }}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {message.text.replace(/<think>/g, '<div class="think">').replace(/<\/think>/g, '</div>')}
              </ReactMarkdown>
              {message.isStreaming && <span className="ml-2 animate-blink">...</span>}
            </div>
          )}
        </div>
      </div>
    ))}
  </div>
</div>

        <div className="border-t border-purple-200 p-4 bg-white/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto relative">
            <div className="flex gap-2 mb-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageUpload(e.target.files[0])}
                className="hidden"
                id="image-upload"
                disabled={loading}
              />
              <label
                htmlFor="image-upload"
                className="p-2 rounded-xl bg-purple-100 hover:bg-purple-200 cursor-pointer transition-colors"
              >
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </label>
            </div>
            
            <div className="relative">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type your message here..."
                className="w-full rounded-2xl border-2 border-purple-200 py-4 pl-6 pr-24 
                  focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100
                  hover:border-purple-300 transition-all duration-200 text-lg shadow-sm
                  disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              />
              <button 
                onClick={handleSendMessage}
                className="absolute right-2 top-2 bg-gradient-to-br from-purple-600 to-indigo-600 p-3 rounded-xl 
                  hover:opacity-90 transition-all duration-200 shadow-md flex items-center justify-center
                  disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? (
                  <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FreeSeek;