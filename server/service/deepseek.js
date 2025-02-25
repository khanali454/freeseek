import { OpenAI } from "openai";

const openai = new OpenAI({
  baseURL: 'https://DeepSeek-R1-omlww.eastus.models.ai.azure.com',
  apiKey: 'blBoynnqppdrVAZcSPPbhPnTJcLvUgvs'
});

export const createCompletion = async (message) => {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "user", content: message },
      ],
      model: "deepseek-chat",
    });

    return completion.choices[0].message.content;
  } catch (error) {
    throw new Error("Completion failed: " + error.message);
  }
};

export const createStreamingCompletion = async (messages) => {
  try {
    const stream = await openai.chat.completions.create({
      messages: messages,
      model: "deepseek-chat",
      max_tokens:8192,
      stream: true,
    });

    return stream;
  } catch (error) {
    throw new Error("Completion failed: " + error.message);
  }
};