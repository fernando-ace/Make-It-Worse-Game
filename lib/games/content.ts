export const MAKE_IT_WORSE_PROMPTS = [
  { id: "reply-all", prompt: "You accidentally reply-all to the entire company. What makes it worse?", options: ["Your boss replies ‘??’", "You attach the wrong screenshot", "The email starts ‘per my last email’", "The CEO replies with a thumbs-up"] },
  { id: "wedding-toast", prompt: "You grab the mic for a wedding toast. What makes it worse?", options: ["You thank the wrong couple", "A slideshow starts by itself", "You say ‘finally’ at the wrong moment", "Your notes are a grocery list"] },
  { id: "group-chat", prompt: "You send a spicy text to the family group chat. What makes it worse?", options: ["Your grandma reacts with a heart", "Nobody replies for six hours", "Your dad asks what the acronym means", "The family chat renames itself after you"] },
  { id: "airport", prompt: "You wave enthusiastically at someone who is not waving at you. What makes it worse?", options: ["They were waving at the person behind you", "You keep waving to recover", "Your friend says ‘you know them?’", "They were filming a video"] },
  { id: "potluck", prompt: "You bring a mystery casserole to a potluck. What makes it worse?", options: ["Someone asks if it is meant to be cold", "The host introduces it as ‘the other one’", "Your dish is still frozen in the middle", "Everyone already brought the same thing"] },
  { id: "karaoke", prompt: "You confidently choose a karaoke song. What makes it worse?", options: ["The words are in another language", "Your friend requests the long version", "The mic is already on", "The next singer is a professional"] },
  { id: "voice-note", prompt: "You send a 4-minute voice note by accident. What makes it worse?", options: ["It is mostly pocket rustling", "You can hear yourself practicing the message", "The recipient replies ‘??’", "It ends with your stomach growling"] },
  { id: "wrong-name", prompt: "You confidently call someone the wrong name. What makes it worse?", options: ["They answer anyway", "Your friend repeats the wrong name", "You are both wearing name tags", "They say ‘we have met three times’"] },
  { id: "surprise-party", prompt: "You walk into your own surprise party early. What makes it worse?", options: ["Everyone hides behind the same curtain", "The cake says another name", "You yell ‘surprise!’ first", "Someone asks you to stall outside"] },
  { id: "meeting-mute", prompt: "You give a passionate speech on a video call while muted. What makes it worse?", options: ["The meeting ends as you finish", "Someone says ‘we can see you’", "You were sharing the wrong screen", "The transcript captured every sigh"] },
  { id: "leftovers", prompt: "You eat the last office leftover. What makes it worse?", options: ["It was labeled with your name", "The owner walks in holding a fork", "It was for the team lunch photo", "There was a note under the lid"] },
  { id: "autocorrect", prompt: "Autocorrect changes your thank-you text. What makes it worse?", options: ["It sends before you notice", "It says ‘thanks, legend’ to your dentist", "You correct it with another typo", "They reply with a screenshot"] },
] as const;

export const TRUST_ME_OPTIONS = [
  { id: "pool", label: "POOL IT", detail: "Everyone gets 3 if the whole group pools." },
  { id: "pocket", label: "POCKET ONE", detail: "Take a safe point and walk away." },
  { id: "risk", label: "DOUBLE OR NOTHING", detail: "Risk it: earn 3 if anyone else risks too." },
  { id: "swipe", label: "SWIPE THE BAG", detail: "Earn 2 if someone pools. Nobody sees this early." },
] as const;
