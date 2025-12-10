
import React, { useState, useEffect, useRef } from 'react';
import { Send, Image as ImageIcon, MoreVertical, Phone, Video, Trash2 } from 'lucide-react';
import { Message, MessageType, MessageStatus, User } from '../types';
import { storageService } from '../services/storageService';
import { socketService } from '../services/socketService';
import MessageBubble from './MessageBubble';
import Avatar from './Avatar';
import { logger } from '../services/logger';

interface ChatInterfaceProps {
  conversationId: string;
  recipient: User;
  currentUser: User;
  onBack?: () => void; // For mobile
  onDeleteFriend?: (id: string) => void;
  jumpToMessageId?: string;
  highlightTerm?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ conversationId, recipient, currentUser, onDeleteFriend, jumpToMessageId, highlightTerm }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
              setShowMenu(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load Messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const msgs = await storageService.getMessages(conversationId);
        messageRefs.current = {};
        setMessages(msgs);
        scrollToBottom();
        // Mark read
        await storageService.markConversationRead(conversationId);
      } catch (error) {
        logger.error('Chat', 'Failed to load messages', error);
      }
    };
    loadMessages();

    // Subscribe to new messages
    const unsubscribe = socketService.onMessage((msg) => {
      if (msg.conversationId === conversationId) {
        setMessages(prev => [...prev, msg]);
        storageService.markConversationRead(conversationId);
        scrollToBottom();
      }
    });

    // Subscribe to delivery receipts
    const unsubscribeReceipt = socketService.onDeliveryReceipt(async (messageId) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: MessageStatus.DELIVERED } : m));
        
        // Update storage
        const allMsgs = await storageService.getMessages(conversationId);
        const msg = allMsgs.find(m => m.id === messageId);
        if (msg) {
            msg.status = MessageStatus.DELIVERED;
            await storageService.saveMessage(msg);
        }
    });

    return () => {
      unsubscribe();
      unsubscribeReceipt();
    };
  }, [conversationId]);

  useEffect(() => {
      scrollToTargetMessage(jumpToMessageId, highlightTerm);
  }, [jumpToMessageId, highlightTerm, messages, conversationId]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const scrollToTargetMessage = (targetId?: string, term?: string) => {
    const id = targetId || '';
    const el = id ? messageRefs.current[id] : null;
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    if (!term) return;
    const lower = term.toLowerCase();
    const hit = messages.find(m => m.type === MessageType.TEXT && m.content.toLowerCase().includes(lower));
    if (hit) {
        const ref = messageRefs.current[hit.id];
        if (ref) {
            ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
  };

  const handleSendMessage = async (type: MessageType = MessageType.TEXT, content: string = inputValue, attachmentData?: string) => {
    if (!content.trim()) return;

    const newMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      senderId: currentUser.id,
      content: content,
      type,
      status: MessageStatus.PENDING,
      timestamp: Date.now(),
    };

    // Optimistic UI Update
    const displayMessage = attachmentData ? { ...newMessage, content: attachmentData } : newMessage;
    setMessages(prev => [...prev, displayMessage]);
    setInputValue('');
    scrollToBottom();
    setIsSending(true);

    try {
      // 1. Save locally
      await storageService.saveMessage(newMessage);

      // 2. Send via Socket
      const socketMessage = attachmentData ? { ...newMessage, content: attachmentData } : newMessage;
      await socketService.sendMessage(socketMessage, recipient.id);

      // 3. Update Status to Sent
      const sentMessage = { ...newMessage, status: MessageStatus.SENT };
      setMessages(prev => prev.map(m => m.id === newMessage.id ? { ...displayMessage, status: MessageStatus.SENT } : m));
      await storageService.saveMessage(sentMessage);

    } catch (error) {
      logger.error('Chat', 'Send failed', error);
      const failedMessage = { ...newMessage, status: MessageStatus.FAILED };
      setMessages(prev => prev.map(m => m.id === newMessage.id ? { ...displayMessage, status: MessageStatus.FAILED } : m));
      await storageService.saveMessage(failedMessage);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        
        try {
            let filename = base64;
            if (window.electronAPI) {
                const result = await window.electronAPI.invoke('file:save-image', base64);
                if (result) filename = result;
            }
            handleSendMessage(MessageType.IMAGE, filename, base64);
        } catch (error) {
            logger.error('Chat', 'Failed to save image', error);
            alert('图片发送失败');
        }
      };
      reader.readAsDataURL(file);
    }
    // Reset input to allow selecting the same file again
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((acc, message) => {
    const date = new Date(message.timestamp).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(message);
    return acc;
  }, {} as Record<string, Message[]>);

  const getStatusText = (status: string) => {
      if (status === 'online') return '当前在线';
      if (status === 'busy') return '忙碌';
      return '离线';
  }

  const handleDelete = () => {
      if(window.confirm(`确定要删除好友 ${recipient.username} 吗？聊天记录也将被清空。`)) {
          if (onDeleteFriend) onDeleteFriend(recipient.id);
      }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 relative transition-colors duration-200">
      {/* Header */}
      <header className="h-16 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between px-4 shadow-sm z-10 transition-colors duration-200 draggable">
        <div className="flex items-center gap-3 no-drag">
          <Avatar name={recipient.username} src={recipient.avatarUrl} status={recipient.status} />
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-white leading-tight">{recipient.username}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{getStatusText(recipient.status)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-slate-400 dark:text-slate-500 relative no-drag">
           <button className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"><Phone size={20} /></button>
           <button className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"><Video size={20} /></button>
           <button 
                className={`hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${showMenu ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
                onClick={() => setShowMenu(!showMenu)}
            >
                <MoreVertical size={20} />
            </button>
            
            {/* Dropdown Menu */}
            {showMenu && (
                <div ref={menuRef} className="absolute top-10 right-0 bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-lg w-40 py-1 z-50 animate-in fade-in zoom-in duration-100">
                    <button 
                        onClick={handleDelete}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                    >
                        <Trash2 size={16} /> 删除好友
                    </button>
                </div>
            )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {Object.entries(groupedMessages).map(([date, msgs]: [string, Message[]]) => (
          <div key={date}>
            <div className="flex justify-center mb-4">
              <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] px-2 py-1 rounded-full uppercase tracking-wide font-medium">
                {date}
              </span>
            </div>
            {msgs.map((msg, idx) => (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                ref={(el) => { messageRefs.current[msg.id] = el; }}
              >
                  <MessageBubble 
                    message={msg} 
                    isMe={msg.senderId === currentUser.id} 
                    showAvatar={idx === 0 || msgs[idx-1].senderId !== msg.senderId}
                    highlightTerm={highlightTerm}
                  />
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 transition-colors duration-200">
        <div className="flex items-end gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-900 focus-within:border-indigo-400 transition-all">
            <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
                <ImageIcon size={20} />
            </button>
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleFileSelect}
            />
            
            <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                    }
                }}
                placeholder="输入消息..."
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[24px] py-2 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                rows={1}
                style={{ height: 'auto', overflow: 'hidden' }}
            />
            
            <button 
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() && !isSending}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                <Send size={18} />
            </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
