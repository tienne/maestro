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
import { useTokens } from '../hooks/useTokens';

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

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHFJABCDsu]|\x1B\][^\x07]*\x07/g, '');
}

let msgCounter = 0;

export function ChatScreen({ navigation, route }: Props) {
  const { sessionId, sessionName } = route.params;
  const { colors, spacing, radius, fontFamilies } = useTokens();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    navigation.setOptions({ title: sessionName });

    const removeHandler = relaySocket.addMessageHandler((msg) => {
      if (msg.type === 'session:output' && msg.sessionId === sessionId && msg.data) {
        const content = stripAnsi(msg.data);
        if (!content.trim()) return;

        const newMsg: ChatMessage = {
          id: `msg-${++msgCounter}-${Date.now()}`,
          content,
          direction: 'incoming',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, newMsg]);
      }
    });

    return () => { removeHandler(); };
  }, [navigation, sessionId, sessionName]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
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

  const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    messageList: { padding: spacing.md, flexGrow: 1 },
    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
    bubble: {
      maxWidth: '82%',
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      marginBottom: spacing.sm,
    },
    incomingBubble: {
      backgroundColor: colors.surface,
      alignSelf: 'flex-start',
    },
    outgoingBubble: {
      backgroundColor: colors.accent,
      alignSelf: 'flex-end',
    },
    incomingText: {
      color: colors.textPrimary,
      fontSize: 13,
      lineHeight: 20,
      fontFamily: monoFont,
    },
    outgoingText: {
      color: colors['on-primary'],
      fontSize: 13,
      lineHeight: 20,
    },
    timestamp: {
      fontSize: 10,
      color: colors.textMuted,
      marginTop: spacing.xxs,
      textAlign: 'right',
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.backgroundSecondary,
    },
    textInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      color: colors.textPrimary,
      fontSize: 14,
      maxHeight: 120,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      fontFamily: monoFont,
    },
    sendBtn: {
      marginLeft: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    sendBtnDisabled: { opacity: 0.4 },
    sendBtnText: { color: colors['on-primary'], fontSize: 14, fontWeight: '600' },
  });

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isOutgoing = item.direction === 'outgoing';
    return (
      <View style={[s.bubble, isOutgoing ? s.outgoingBubble : s.incomingBubble]}>
        <Text style={isOutgoing ? s.outgoingText : s.incomingText}>{item.content}</Text>
        <Text style={s.timestamp}>
          {new Date(item.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={s.messageList}
        ListEmptyComponent={
          <View style={s.emptyContainer}>
            <Text style={s.emptyText}>세션에 연결되었습니다. 명령을 입력해보세요.</Text>
          </View>
        }
      />

      <View style={s.inputRow}>
        <TextInput
          style={s.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="명령 입력..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[s.sendBtn, !inputText.trim() && s.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
          activeOpacity={0.8}
        >
          <Text style={s.sendBtnText}>전송</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
