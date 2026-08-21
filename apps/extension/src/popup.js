const input = document.querySelector("#api-key");
const youtubeUrl = document.querySelector("#youtube-url");
const generateQuiz = document.querySelector("#generate-quiz");
const downloadText = document.querySelector("#download-text");
const save = document.querySelector("#save");
const remove = document.querySelector("#remove");
const reload = document.querySelector("#reload");
const version = document.querySelector("#version");
const status = document.querySelector("#status");
const quizOutput = document.querySelector("#quiz-output");

version.textContent = `Extension ${chrome.runtime.getManifest().version}`;

function setStatus(message, tone = "") {
  status.textContent = message;
  status.dataset.tone = tone;
}

function setBusy(busy) {
  save.disabled = busy;
  remove.disabled = busy;
  reload.disabled = busy;
  downloadText.disabled = busy;
  generateQuiz.disabled = busy;
}

function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      return /^[\w-]{11}$/.test(url.pathname.slice(1))
        ? url.pathname.slice(1)
        : null;
    }
    if (
      url.hostname === "youtube.com" ||
      url.hostname.endsWith(".youtube.com")
    ) {
      const videoId = url.searchParams.get("v");
      return videoId && /^[\w-]{11}$/.test(videoId) ? videoId : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function refresh() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (youtubeVideoId(activeTab?.url)) youtubeUrl.value = activeTab.url;
  const result = await chrome.runtime.sendMessage({
    type: "clipquest.key.get.v1",
  });
  if (result?.configured) {
    input.placeholder = "Key saved locally";
    setStatus("A DeepSeek key is configured on this browser.", "success");
  } else {
    input.placeholder = "sk-…";
    setStatus("Add your key before generating a quiz.");
  }
}

downloadText.addEventListener("click", async () => {
  const videoId = youtubeVideoId(youtubeUrl.value.trim());
  if (!videoId) {
    setStatus("Paste a valid YouTube video URL.", "error");
    return;
  }
  setBusy(true);
  setStatus("Downloading captions and removing timestamps…");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "clipquest.captions.download-text.v1",
      videoId,
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "The caption download failed.");
    }
    setStatus(
      `Saved ${result.filename} · ${result.segmentCount} caption segments · no timestamps.`,
      "success",
    );
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "The caption download failed.",
      "error",
    );
  } finally {
    setBusy(false);
  }
});

generateQuiz.addEventListener("click", () => {
  const videoId = youtubeVideoId(youtubeUrl.value.trim());
  if (!videoId) {
    setStatus("Paste a valid YouTube video URL.", "error");
    return;
  }
  setBusy(true);
  quizOutput.hidden = true;
  quizOutput.textContent = "";
  setStatus("Reading captions and converting them to plain text…");
  const requestId = crypto.randomUUID();
  const port = chrome.runtime.connect({ name: "clipquest-local-ai-v1" });
  let settled = false;
  const heartbeat = setInterval(() => {
    try {
      port.postMessage({ type: "heartbeat", requestId });
    } catch {
      // The disconnect listener reports the terminal error.
    }
  }, 20_000);
  const finish = (message, tone) => {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    setBusy(false);
    setStatus(message, tone);
    port.disconnect();
  };
  port.onMessage.addListener((message) => {
    if (message?.requestId !== requestId) return;
    if (message.type === "progress") {
      const percent = Math.round(Number(message.progress ?? 0) * 100);
      const attempt = Number(message.attempt ?? 1);
      const maxAttempts = Number(message.maxAttempts ?? 3);
      setStatus(
        message.stage === "getting_video"
          ? `Reading YouTube captions… ${percent}%`
          : `${message.status === "retrying" ? "Retrying invalid quiz output" : "DeepSeek is generating the complete quiz"} · attempt ${attempt}/${maxAttempts} · ${percent}%`,
      );
      return;
    }
    if (message.type !== "result") return;
    if (!message.response?.ok) {
      finish(
        message.response?.error ?? "Local quiz generation failed.",
        "error",
      );
      return;
    }
    quizOutput.textContent = JSON.stringify(
      message.response.result.quiz,
      null,
      2,
    );
    quizOutput.hidden = false;
    finish(
      `Generated ${message.response.result.quiz.questions.length} questions in ${message.response.result.metrics.aiCalls} DeepSeek call(s) and saved ${message.response.result.filename}.`,
      "success",
    );
  });
  port.onDisconnect.addListener(() => {
    if (settled) return;
    finish(
      chrome.runtime.lastError?.message ??
        "The local generation connection stopped.",
      "error",
    );
  });
  port.postMessage({
    type: "generate",
    requestId,
    videoId,
    quizLanguage: "en",
    questionCount: 15,
    questionTypes: ["multiple_choice", "true_false", "short_answer"],
  });
});

save.addEventListener("click", async () => {
  const apiKey = input.value.trim();
  setBusy(true);
  setStatus("Saving and testing the key…");
  try {
    const saved = await chrome.runtime.sendMessage({
      type: "clipquest.key.save.v1",
      apiKey,
    });
    if (!saved?.ok)
      throw new Error(saved?.error ?? "The key could not be saved.");
    const tested = await chrome.runtime.sendMessage({
      type: "clipquest.key.test.v1",
    });
    if (!tested?.ok) {
      await chrome.runtime.sendMessage({ type: "clipquest.key.delete.v1" });
      throw new Error(tested?.error ?? "DeepSeek rejected the key.");
    }
    input.value = "";
    setStatus("Key verified. ClipQuest can now generate locally.", "success");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "The key test failed.",
      "error",
    );
  } finally {
    setBusy(false);
  }
});

remove.addEventListener("click", async () => {
  setBusy(true);
  await chrome.runtime.sendMessage({ type: "clipquest.key.delete.v1" });
  input.value = "";
  setStatus("The local DeepSeek key was removed.", "success");
  setBusy(false);
});

reload.addEventListener("click", () => {
  chrome.runtime.reload();
});

void refresh();
