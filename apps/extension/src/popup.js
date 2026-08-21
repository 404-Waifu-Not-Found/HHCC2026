const input = document.querySelector("#api-key");
const form = document.querySelector("#deepseek-config");
const save = document.querySelector("#save");
const remove = document.querySelector("#remove");
const status = document.querySelector("#status");
let busy = false;
let configured = false;

function setStatus(message, tone = "") {
  status.textContent = message;
  status.dataset.tone = tone;
  status.classList.remove("is-updating");
  void status.offsetWidth;
  status.classList.add("is-updating");
}

function syncActions() {
  document.documentElement.dataset.busy = String(busy);
  save.disabled = busy || !input.value.trim();
  remove.disabled = busy || !configured;
}

async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({
      type: "clipquest.key.get.v1",
    });
    configured = Boolean(result?.configured);
    if (configured) {
      input.placeholder = "Key saved locally";
      setStatus("A DeepSeek key is configured on this browser.", "success");
    } else {
      input.placeholder = "sk-…";
      setStatus("Add your DeepSeek key to finish setup.");
    }
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "The extension could not read its DeepSeek configuration.",
      "error",
    );
  }
  syncActions();
}

input.addEventListener("input", syncActions);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = input.value.trim();
  busy = true;
  syncActions();
  setStatus("Saving and testing the key…");
  try {
    const tested = await chrome.runtime.sendMessage({
      type: "clipquest.key.test.v1",
      apiKey,
    });
    if (!tested?.ok) {
      configured = false;
      throw new Error(tested?.error ?? "DeepSeek rejected the key.");
    }
    const saved = await chrome.runtime.sendMessage({
      type: "clipquest.key.save.v1",
      apiKey,
    });
    if (!saved?.ok)
      throw new Error(saved?.error ?? "The key could not be saved.");
    configured = true;
    input.value = "";
    input.placeholder = "Key saved locally";
    setStatus("Key verified. ClipQuest can now generate locally.", "success");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "The key test failed.",
      "error",
    );
  } finally {
    busy = false;
    syncActions();
  }
});

remove.addEventListener("click", async () => {
  busy = true;
  syncActions();
  try {
    await chrome.runtime.sendMessage({ type: "clipquest.key.delete.v1" });
    configured = false;
    input.value = "";
    input.placeholder = "sk-…";
    setStatus("The local DeepSeek key was removed.", "success");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "The key could not be removed.",
      "error",
    );
  } finally {
    busy = false;
    syncActions();
  }
});

void refresh();
