export type JsonObject = Record<string, unknown>;

export type JsonRpcRequest = {
  id: string | number;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  id: string | number;
  result: unknown;
};

export type JsonRpcError = {
  id: string | number;
  error: { code: number; message: string; data?: unknown };
};

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse
  | JsonRpcError;

