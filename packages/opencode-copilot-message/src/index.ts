import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";

export const CopilotMessage: Plugin = async (
  _input: PluginInput,
): Promise<Hooks> => {
  return {
    "experimental.chat.messages.transform": async (_hookInput, output) => {
      for (const message of output.messages) {
        const info = message.info as {
          role: "user" | "assistant";
          model?: { providerID?: string };
        };

        if (
          info.role === "user" &&
          info.model?.providerID === "github-copilot"
        ) {
          info.role = "assistant";
        }
      }
    },
  };
};

export default CopilotMessage;
