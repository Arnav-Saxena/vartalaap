type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Profile = {
  id: string;
  display_name: string;
  email: string;
  avatar_seed: string;
  avatar_style: string;
  avatar_path: string | null;
  created_at: string;
};

export type DirectConversation = {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
};

export type DirectMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

export type AiProfile = {
  user_id: string;
  companion_name: string;
  personality: string;
  instructions: string;
  preferences: string;
  updated_at: string;
};

export type AiMessage = {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AiMemory = {
  id: string;
  user_id: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      direct_conversations: Table<DirectConversation>;
      messages: Table<DirectMessage>;
      ai_profiles: Table<AiProfile>;
      ai_messages: Table<AiMessage>;
      ai_memories: Table<AiMemory>;
    };
    Views: Record<string, never>;
    Functions: {
      search_profiles: {
        Args: { p_query: string };
        Returns: Profile[];
      };
      get_or_create_direct_conversation: {
        Args: { p_other_user_id: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
