import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface AssistantMessage {
  'content' : [] | [string],
  'tool_calls' : Array<ToolCall>,
}
export type ChatMessage = {
    'tool' : { 'content' : string, 'tool_call_id' : string }
  } |
  { 'user' : { 'content' : string } } |
  { 'assistant' : AssistantMessage } |
  { 'system' : { 'content' : string } };
export interface FunctionCall {
  'name' : string,
  'arguments' : Array<ToolCallArgument>,
}
export interface ToolCall { 'id' : string, 'function' : FunctionCall }
export interface ToolCallArgument { 'value' : string, 'name' : string }
export interface _SERVICE {
  'get_rag_response' : ActorMethod<
    [string, string, Array<ChatMessage>],
    string
  >,
  'prompt_model' : ActorMethod<[string], string>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
