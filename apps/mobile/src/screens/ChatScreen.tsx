import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { relaySocket } from '../lib/relaySocket';
import type { RootStackParamList } from '../types/navigation';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Chat'>;
  route: RouteProp<RootStackParamList, 'Chat'>;
};

interface ChatMessage {
  id: string;
  content: string;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
}

/** ANSI 이스케이프 코드 제거 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHFJABCDsu]|\x1B\][^\x07]*\x07/g, '');
}

let msgCounter = 0;

export function ChatScreen({ navigation, route }: Props) {
  const { sessionId, sessionName } = route.params;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    navigation.setOptions({ title: sessionName });

    const removeHandler = relaySocket.addMessageHandler((msg) => {
      if (msg.type === 'session:output' && msg.sessionId === sessionId && msg.data) {
        const content = stripAnsi(msg.data);
        if (!content.trim()) return; // 빈 ANSI 메시지 무시

        const newMsg: ChatMessage = {
          id: `msg-${++msgCounter}-${Date.now()}`,
          content,
          direction: 'incoming',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, newMsg]);
      }
    });

    return () => {
      removeHandler();
    };
  }, [navigation, sessionId, sessionName]);

  // 새 메시지 수신 시 스크롤 하단 이동
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;

    relaySocket.sendInput(sessionId, text);

    const sentMsg: ChatMessage = {
      id: `msg-${++msgCounter}-${Date.now()}`,
      content: text,
      direction: 'outgoing',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, sentMsg]);
    setInputText('');
  }, [inputText, sessionId]);

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isOutgoing = item.direction === 'outgoing';
    return (
      <View
        style={[
          styles.messageBubble,
          isOutgoing ? styles.outgoingBubble : styles.incomingBubble,
        ]}
      >
        <Text
          style={[
            styles.messageText,
            isOutgoing ? styles.outgoingText : styles.incomingText,
          ]}
        >
          {item.content}
        </Text>
        <Text style={styles.timestamp}>
          {new Date(item.timestamp).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              세션에 연결되었습니다. 명령을 입력해보세요.
            </Text>
          </View>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="명령 입력..."
          placeholderTextColor="#666"
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Text style={styles.sendBtnText}>전송</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  messageList: {
    padding: 12,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: '#6666aa',
    fontSize: 14,
    textAlign: 'center',
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  incomingBubble: {
    backgroundColor: '#1a1a3e',
    alignSelf: 'flex-start',
  },
  outgoingBubble: {
    backgroundColor: '#5b4fff',
    alignSelf: 'flex-end',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  incomingText: {
    color: '#d0d0ff',
  },
  outgoingText: {
    color: '#ffffff',
  },
  timestamp: {
    fontSize: 10,
    color: '#8888aa',
    marginTop: 4,
    textAlign: 'right',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
    backgroundColor: '#0d0d1a',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#e0e0ff',
    fontSize: 14,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#2a2a4e',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#5b4fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
