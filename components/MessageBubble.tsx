
import React, { useState, useEffect } from 'react';
import { Message, MessageType, MessageStatus } from '../types';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  showAvatar?: boolean;
  highlightTerm?: string;
}

const formatTime = (ts: number) => {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isMe, showAvatar, highlightTerm }) => {
  const [imageUrl, setImageUrl] = useState<string>(
      message.type === MessageType.IMAGE && message.content.startsWith('data:') 
      ? message.content 
      : ''
  );

  useEffect(() => {
      if (message.type === MessageType.IMAGE && !message.content.startsWith('data:')) {
          // It's a filename, load it
          if (window.electronAPI) {
              window.electronAPI.invoke('file:read-image', message.content)
                  .then(base64 => {
                      if (base64) setImageUrl(base64);
                  })
                  .catch(err => console.error('Failed to load image', err));
          }
      } else if (message.type === MessageType.IMAGE) {
          setImageUrl(message.content);
      }
  }, [message.content, message.type]);
  
  const getStatusIcon = () => {
    switch (message.status) {
      case MessageStatus.PENDING: return <Clock size={12} className="text-slate-400" />;
      case MessageStatus.SENT: return <Check size={12} className="text-slate-400" />;
      case MessageStatus.DELIVERED: return <CheckCheck size={12} className="text-blue-500" />;
      case MessageStatus.FAILED: return <AlertCircle size={12} className="text-red-500" />;
      default: return null;
    }
  };

  const renderText = (text: string) => {
      if (!highlightTerm) return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>;
      const term = highlightTerm.trim();
      if (!term) return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>;
      const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
      return (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {parts.map((part, idx) => part.toLowerCase() === term.toLowerCase()
              ? <mark key={idx} className="bg-yellow-200 text-slate-900 rounded px-0.5">{part}</mark>
              : <React.Fragment key={idx}>{part}</React.Fragment>
            )}
        </p>
      );
  };

  return (
    <div className={`flex w-full mb-4 ${isMe ? 'justify-end' : 'justify-start'}`}>
      {!isMe && showAvatar && (
        <div className="mr-2 flex-shrink-0 self-end">
           {/* Placeholder for avatar if needed, handled by parent usually */}
        </div>
      )}
      
      <div className={`max-w-[70%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        <div
          className={`relative px-4 py-2 shadow-sm ${
            message.type === MessageType.IMAGE ? 'p-1 bg-transparent shadow-none' : ''
          } ${
            isMe
              ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-sm'
              : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm'
          }`}
        >
          {message.type === MessageType.TEXT && renderText(message.content)}

          {message.type === MessageType.IMAGE && (
            <div className="relative">
                {imageUrl ? (
                    <img 
                        src={imageUrl} 
                        alt="Attachment" 
                        className="rounded-lg max-h-64 object-cover border border-slate-200 dark:border-slate-700"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-48 h-32 bg-slate-200 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                        <span className="text-xs text-slate-500">加载中...</span>
                    </div>
                )}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-1 mt-1 px-1">
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {formatTime(message.timestamp)}
          </span>
          {isMe && getStatusIcon()}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
