import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@calimero-network/mero-ui';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X } from 'lucide-react';
import { generateQueryEmbedding } from '../services/embeddingService';
import { DocumentService } from '../api/documentService';
import {
  Loader,
  Box,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';
import { llmChatbotService } from '../api/icp/backendService';
import { useTheme } from '../contexts/ThemeContext';

// Constants
const CHAT_CONFIG = {
  DEFAULT_CONTEXT_LIMIT: 800,
  AGGRESSIVE_CONTEXT_LIMIT: 400,
  MAX_REQUEST_SIZE: 1500,
  FALLBACK_REQUEST_SIZE: 1000,
  HISTORY_TRUNCATE_LENGTH: 80,
  REQUEST_TIMEOUT: 30000,
} as const;

const ERROR_MESSAGES = {
  TIMEOUT: 'The request took too long. Please try a simpler, shorter question.',
  TOO_COMPLEX:
    'Your question is too complex. Please ask a shorter, more focused question.',
  NETWORK: 'Network error. Please check your connection and try again.',
  DEFAULT: 'An error occurred while processing your query.',
} as const;

// Types
interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface LegalChatbotProps {
  isOpen: boolean;
  onClose: () => void;
  contextId?: string;
  documentID: string;
  agreementContextID?: string;
  agreementContextUserID?: string;
}

const LegalChatbot: React.FC<LegalChatbotProps> = ({
  isOpen,
  onClose,
  documentID,
  agreementContextID,
  agreementContextUserID,
}) => {
  const { mode } = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const documentService = new DocumentService();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hello! I'm your legal assistant. Ask me questions about this document, and I'll provide context based on its content.",
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const addMessage = (text: string, sender: 'user' | 'bot') => {
    if (!text || typeof text !== 'string') {
      console.warn('Invalid message text:', text);
      return;
    }

    const newMessage: Message = {
      id: Date.now().toString(),
      text,
      sender,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const estimateRequestSize = (
    prompt: string,
    context: string,
    history: any[],
  ): number => {
    const historySize = history.reduce((acc, msg) => {
      if (msg.user?.content) acc += msg.user.content.length;
      if (msg.assistant?.content?.[0]) acc += msg.assistant.content[0].length;
      return acc;
    }, 0);
    return prompt.length + context.length + historySize;
  };

  const trimContextAggressively = (
    context: string,
    maxLength: number = CHAT_CONFIG.DEFAULT_CONTEXT_LIMIT,
  ): string => {
    if (context.length <= maxLength) return context;

    const sentences = context.split(/[.!?]\s+/);
    let trimmedContext = '';

    for (const sentence of sentences) {
      if (trimmedContext.length + sentence.length + 2 <= maxLength) {
        trimmedContext += (trimmedContext ? '. ' : '') + sentence;
      } else {
        break;
      }
    }

    return trimmedContext || context.substring(0, maxLength - 3) + '...';
  };

  const getErrorMessage = (error: Error): string => {
    const { message } = error;

    if (message.includes('timeout') || message.includes('Request timeout')) {
      return ERROR_MESSAGES.TIMEOUT;
    }
    if (message.includes('exceed') || message.includes('too large')) {
      return ERROR_MESSAGES.TOO_COMPLEX;
    }
    if (message.includes('network') || message.includes('connection')) {
      return ERROR_MESSAGES.NETWORK;
    }

    return ERROR_MESSAGES.DEFAULT;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    addMessage(input, 'user');
    const userInput = input;
    setInput('');
    setIsLoading(true);

    try {
      const queryEmbeddings = await generateQueryEmbedding(userInput);
      const searchResponse = await documentService.searchDocumentByEmbedding(
        queryEmbeddings,
        documentID,
        agreementContextID,
        agreementContextUserID,
      );

      let context = '';
      if (searchResponse.data) {
        context = trimContextAggressively(searchResponse.data);
      } else {
        context = searchResponse.error
          ? `Error: ${searchResponse.error.message}`
          : 'No context found.';
      }

      const limitedHistory = messages
        .slice(-1)
        .filter((msg) => msg.text && msg.text.trim())
        .map((msg) => {
          const truncatedText = msg.text.substring(
            0,
            CHAT_CONFIG.HISTORY_TRUNCATE_LENGTH,
          );
          return msg.sender === 'user'
            ? { user: { content: truncatedText } }
            : { assistant: { content: [truncatedText], tool_calls: [] } };
        });

      let estimatedSize = estimateRequestSize(
        userInput,
        context,
        limitedHistory,
      );

      if (estimatedSize > CHAT_CONFIG.MAX_REQUEST_SIZE) {
        context = trimContextAggressively(
          context,
          CHAT_CONFIG.AGGRESSIVE_CONTEXT_LIMIT,
        );
        estimatedSize = estimateRequestSize(userInput, context, []);

        if (estimatedSize > CHAT_CONFIG.FALLBACK_REQUEST_SIZE) {
          addMessage(ERROR_MESSAGES.TOO_COMPLEX, 'bot');
          return;
        }

        limitedHistory.length = 0;
      }

      const llmService = await llmChatbotService();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Request timeout')),
          CHAT_CONFIG.REQUEST_TIMEOUT,
        ),
      );

      const llmResponse = (await Promise.race([
        llmService.getRagResponse(userInput, context, limitedHistory),
        timeoutPromise,
      ])) as string;

      let responseText = llmResponse;
      try {
        if (llmResponse && typeof llmResponse === 'string') {
          const parsedResponse = JSON.parse(llmResponse);
          responseText = parsedResponse.answer || llmResponse;
        }
      } catch (parseError) {
        console.warn('Failed to parse LLM response as JSON:', parseError);
        responseText = llmResponse || 'No response received from AI assistant.';
      }

      addMessage(responseText, 'bot');
    } catch (error) {
      console.error('Error processing message:', error);
      const errorMessage =
        error instanceof Error
          ? getErrorMessage(error)
          : ERROR_MESSAGES.DEFAULT;
      addMessage(errorMessage, 'bot');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessage = (msg: Message) => (
    <div
      key={msg.id}
      className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-xs px-4 py-2 rounded-lg ${
          mode === 'dark'
            ? 'bg-gray-700 text-white'
            : 'bg-gray-200 text-gray-900'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
        <p
          className={`text-xs opacity-70 mt-1 ${
            mode === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}
        >
          {msg.timestamp.toLocaleTimeString()}
        </p>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 backdrop-blur-sm flex items-center justify-center p-4 z-[10000] ${
          mode === 'dark' ? 'bg-black/50' : 'bg-black/30'
        }`}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className={`rounded-lg shadow-2xl w-full max-w-md h-[600px] flex flex-col ${
            mode === 'dark'
              ? 'bg-[#1a1a1a] border border-[#333]'
              : 'bg-white border border-gray-200'
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between p-4 border-b ${
              mode === 'dark' ? 'border-[#333]' : 'border-gray-200'
            }`}
          >
            <h3
              className={`text-lg font-semibold ${
                mode === 'dark' ? 'text-white' : 'text-gray-900'
              }`}
            >
              Legal Assistant
            </h3>
            <Button
              variant="secondary"
              onClick={onClose}
              style={{ minWidth: 34, minHeight: 34 }}
            >
              <X size={20} />
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(renderMessage)}

            {isLoading && (
              <div className="flex justify-start">
                <Box
                  style={{
                    padding: `${spacing[3].value}px ${spacing[4].value}px`,
                    borderRadius: radius.lg.value,
                    background:
                      mode === 'dark'
                        ? colors.neutral[800].value
                        : colors.neutral[200].value,
                  }}
                >
                  <Loader size="small" />
                </Box>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            className={`p-4 border-t ${
              mode === 'dark' ? 'border-[#333]' : 'border-gray-200'
            }`}
          >
            <div className="flex space-x-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask a legal question about the document..."
                className={`flex-1 px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  mode === 'dark'
                    ? 'border-[#333] bg-[#262626] text-white placeholder-gray-400'
                    : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500'
                }`}
                disabled={isLoading}
                type="text"
              />
              <Button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                style={{ borderRadius: 9999, padding: '8px 12px' }}
              >
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default LegalChatbot;
