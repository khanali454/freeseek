import React, { useState, useEffect } from 'react';
import he from 'he';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeRaw from 'rehype-raw';
import { useNavigate } from 'react-router';

const FreeSeek = () => {
  const history = useNavigate();
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Authentication check
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      history('/login');
    } else {
      fetchChats();
    }
  }, [history]);


  // Fetch user's chats
  const fetchChats = async () => {
    try {
      const response = await fetch('https://freeseek-server-fmbbc2bbftb6a7he.canadacentral-01.azurewebsites.net/chats', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        if (response.status == 401) {
          localStorage.removeItem('token');
          history.push('/login');
        } else if (response.status == 504) {
          throw new Error('Server is taking too long to respond. Please try again later.');
        } else {
          throw new Error(`Failed to fetch chats: ${response.statusText}`);
        }
      }

      const data = await response.json();
      setChats(data);
      setActiveChatId(data[0]?._id);
    } catch (error) {
      console.error('Error fetching chats:', error);
      setError(error.message);
    }
  };

  // Handle message submission
  const handleSendMessage = async () => {
    if (!newMessage.trim() || loading) return;

    const isNewChat = !activeChatId;
    const tempChatId = `temp-${Date.now()}`;
    const tempUserMsgId = Date.now();
    const tempAiMsgId = Date.now() + 1;

    try {
      setLoading(true);


      setError(null);

      // Optimistic UI update
      updateChatsOptimistically(isNewChat, tempChatId, tempUserMsgId, tempAiMsgId);

      // Determine API endpoint
      const endpoint = isNewChat ? '/chats/stream' : `/chats/${activeChatId}/messages`;

      const response = await fetch(
        `https://freeseek-server-fmbbc2bbftb6a7he.canadacentral-01.azurewebsites.net${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ content: newMessage }),
        }
      );

      if (!response.ok) {
        if (response.status === 504) {
          throw new Error('Server is taking too long to respond. Please try again later.');
        } else {
          throw new Error(`Failed to send message: ${response.statusText}`);
        }
      }

      // Handle streaming response
      await handleStreamingResponse(response, isNewChat, tempChatId, tempAiMsgId);

      // Refresh chat list for new chats
      if (isNewChat) await fetchChats();
    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
      rollbackOptimisticUpdates(isNewChat, tempChatId, tempUserMsgId);
    } finally {
      setLoading(false);
      setNewMessage('');
    }
  };

  // Optimistic UI update
  const updateChatsOptimistically = (isNewChat, tempChatId, tempUserMsgId, tempAiMsgId) => {
    const newMessageObj = {
      _id: tempUserMsgId,
      role: 'user',
      content: newMessage,
      createdAt: new Date().toISOString(),
    };

    if (isNewChat) {
      const tempChat = {
        _id: tempChatId,
        title: newMessage,
        messages: [newMessageObj],
        createdAt: new Date().toISOString(),
      };
      setChats([tempChat, ...chats]);
      setActiveChatId(tempChatId);
    } else {
      setChats(chats.map(chat =>
        chat._id === activeChatId ?
          { ...chat, messages: [...chat.messages, newMessageObj] } :
          chat
      ));
    }

    // Add temporary AI message
    setChats(prevChats => prevChats.map(chat =>
      chat._id === (isNewChat ? tempChatId : activeChatId) ? {
        ...chat,
        messages: [...chat.messages, {
          _id: tempAiMsgId,
          role: 'assistant',
          content: '',
          isStreaming: true
        }]
      } : chat
    ));
  };


  // Updated handleStreamingResponse function
  const handleStreamingResponse = async (response, isNewChat, tempChatId, tempAiMsgId) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aiContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      // Process complete SSE events
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const dataLine = event.split('\n').find(line => line.startsWith('data: '));
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine.slice(6));
            aiContent += data.content;
          } catch (error) {
            console.error('Error parsing SSE event:', error);
          }
        }
      }

      setChats(prevChats => prevChats.map(chat =>
        chat._id === (isNewChat ? tempChatId : activeChatId) ? {
          ...chat,
          messages: chat.messages.map(msg =>
            msg._id === tempAiMsgId ? {
              ...msg,
              content: aiContent,
              isStreaming: !done
            } : msg
          )
        } : chat
      ));
    }
  };

  // Rollback optimistic updates
  const rollbackOptimisticUpdates = (isNewChat, tempChatId, tempUserMsgId) => {
    setChats(prevChats => isNewChat ?
      prevChats.filter(chat => chat._id !== tempChatId) :
      prevChats.map(chat =>
        chat._id === activeChatId ?
          { ...chat, messages: chat.messages.filter(m => m._id !== tempUserMsgId) } :
          chat
      )
    );
  };

  // Custom Markdown components
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


  };

  const Parse = (ct) => {
    console.log(" total :", ct);
    let vct = ct.replace('<think>', '<div className="text-gray-500 text-sm border-l-2 border-gray-300 pl-2 my-2"> <b>Thinking: </b>').replace('</think>', '</div>');
    console.log("vct : ", vct);
    return vct;
  }

  const activeChat = chats.find(chat => chat._id === activeChatId);

  return (
    <div className="flex h-screen bg-gradient-to-br from-purple-50 to-indigo-50">
      {/* Chat List Sidebar */}
      <div className="w-64 bg-white shadow-xl flex flex-col border-r border-purple-200">
        <div className="p-4 border-b border-purple-200">
          <button
            onClick={() => setActiveChatId(null)}
            className="w-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-xl py-3 px-4 
              hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg
              flex items-center justify-center gap-2"
            aria-label="Start new chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
            </svg>
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-purple-200 scrollbar-track-gray-50">
          {chats.map((chat) => (
            <div
              key={chat._id}
              onClick={() => setActiveChatId(chat._id)}
              className={`group px-4 py-3 hover:bg-purple-50 cursor-pointer transition-colors
                border-b border-purple-100 ${activeChatId === chat._id ?
                  'bg-purple-50 border-l-4 border-purple-500' : ''}`}
            >
              <div className={`text-gray-700 truncate font-medium ${activeChatId === chat._id ? 'text-purple-900' : ''}`}>
                {chat.title}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(chat.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="border-b border-purple-200 p-4 flex items-center justify-between bg-white/80 backdrop-blur-sm">
          <div className="text-2xl font-bold text-purple-900 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
            </svg>
            FreeSeek
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          <div className="max-w-3xl w-full mx-auto space-y-4">
            {activeChat?.messages?.map((message) => (
              <div
                key={message._id}
                className={`flex ${message.role === 'assistant' ? 'items-start' : 'justify-end'} gap-4`}
              >
                {message.role === 'assistant' && (
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl 
                    flex items-center justify-center text-white shadow-md">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 16h-2v-2h2v2zm2.1-5.37l-.71.71c-.2.2-.51.2-.71 0l-.71-.71c-.2-.2-.2-.51 0-.71l1.41-1.41c.2-.2.51-.2.71 0l1.41 1.41c.2.2.2.51 0 .71l-.71.71zM18 10h-2V8h2v2z" />
                    </svg>
                  </div>
                )}

                {message.role === 'assistant' && (
                  <div className={`max-w-[80%] rounded-2xl p-4 ${message.role === 'assistant'
                    ? 'bg-white border border-gray-100'
                    : 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white'
                    } ${message.isStreaming ? 'animate-pulse' : ''}`}>
                    <ReactMarkdown
                      components={MarkdownComponents}
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                    >
                      {Parse(message.content)}
                    </ReactMarkdown>
                    {message.isStreaming && (
                      <span className="ml-2 animate-blink">...</span>
                    )}
                  </div>
                )}

                {message.role !== 'assistant' && (
                  <div className={`max-w-[80%] rounded-2xl p-4 bg-gradient-to-br from-purple-600 to-indigo-600 text-white`}>

                    {message.content}

                  </div>
                )}

              </div>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-purple-200 p-4 bg-white/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto relative">
            {error && (
              <div className="text-red-500 text-sm mb-2">
                {error}
              </div>
            )}
            <div className="relative">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    handleSendMessage();
                  }
                }}
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
                aria-label="Send message"
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