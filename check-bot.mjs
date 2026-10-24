import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const bot = new Bot(token);

bot.init().then(() => {
  console.log("Bot info:", JSON.stringify(bot.botInfo, null, 2));
  process.exit(0);
}).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
