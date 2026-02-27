import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";

type ExperimentalMessageTransformHook = NonNullable<
  Hooks["experimental.chat.messages.transform"]
>;
type TransformMessage =
  Parameters<ExperimentalMessageTransformHook>[1]["messages"][number];

const HOOK_NAME = "experimental.chat.messages.transform";
function isGithubCopilotProvider(message: TransformMessage): boolean {
  const info = message.info as TransformMessage["info"] & {
    providerID?: string;
    providerId?: string;
  };
  const providerId = info.providerID ?? info.providerId;
  return providerId === "github-copilot";
}

function coerceGithubCopilotRole(message: TransformMessage): void {
  if (!isGithubCopilotProvider(message)) {
    return;
  }

  const info = message.info as Omit<TransformMessage["info"], "role"> & {
    role: string;
  };
  info.role = "tool";
}
export const CopilotMessage: Plugin = async (
  _input: PluginInput,
): Promise<Hooks> => {
  const transformHook: ExperimentalMessageTransformHook = async (
    _input,
    output,
  ) => {
    for (const message of output.messages) {
      coerceGithubCopilotRole(message);
    }
  };
  return {
    [HOOK_NAME]: transformHook,
  };
};

export default CopilotMessage;
