# Setting Up Custom Models in Cursor (e.g., GLM-5)

This guide documents how to add OpenAI-compatible custom models (like GLM-5) to Cursor IDE and what to expect regarding billing and feature availability.

## Overview

Cursor lets you use your own API key with an overridden OpenAI-compatible base URL. This enables models such as:

- **GLM-5** (Zhipu AI) — strong coding and agent benchmarks, cheaper than Composer 1.5
- **Other OpenAI-compatible models** — DeepSeek, local LLMs, OpenRouter models, etc.

## Prerequisites

- Cursor Pro or higher (custom models require a paid plan)
- An API key and base URL from your chosen provider

---

## How to Add GLM-5 as a Custom Model

1. **Get a GLM-5 API key** — Use [Modal (free)](https://modal.com/glm-5-endpoint) or [Z.AI (paid)](https://z.ai)
2. **Open Cursor Settings** — Press ⌘ + , and go to **Models** → **API Keys** → **OpenAI API Key**
3. **Enable your key** — Toggle **Enable OpenAI API Key** and confirm the dialog
4. **Enter API key** — Paste your key into the API key field
5. **Override base URL** — Turn on **Override OpenAI Base URL** and paste:
   - **Modal:** `https://api.us-west-2.modal.direct/v1`
   - **Z.AI:** `https://api.z.ai/api/paas/v4/`
6. **Add model** — Click the `+` button and enter:
   - **Modal:** `zai-org/GLM-5-FP8`
   - **Z.AI:** `glm-5`
7. **Verify** — Click **Verify** to test the connection
8. **Use it** — Choose GLM-5 from the model dropdown in Chat, Composer, or Cmd+K

---

## Step-by-Step Setup

### 1. Get an API Key

#### Option A: Modal.com (free until April 30, 2026)

1. Sign up at [modal.com](https://modal.com) (free account is enough)
2. Visit [https://modal.com/glm-5-endpoint](https://modal.com/glm-5-endpoint)
3. Log in and copy your API key
4. Use these values in Cursor:
   - **Base URL:** `https://api.us-west-2.modal.direct/v1`
   - **Model:** `zai-org/GLM-5-FP8`

#### Option B: Z.AI (paid)

1. Create an account at [z.ai](https://z.ai) or [open.bigmodel.cn](https://open.bigmodel.cn)
2. Generate an API key
3. Use these values in Cursor:
   - **Base URL:** `https://api.z.ai/api/paas/v4/`
   - **Model:** `glm-5`

### 2. Configure in Cursor

1. Open **Settings** (⌘ + , or File → Preferences → Settings)
2. Go to **Models** → **API Keys** → **OpenAI API Key**
3. Toggle **Enable OpenAI API Key** — you’ll see a confirmation dialog (see [Understanding the Enable Dialog](#understanding-the-enable-dialog))
4. Enter your **API key**
5. Enable **Override OpenAI Base URL** and enter the base URL (with trailing slash for Modal)
6. Add the **model name** with the `+` button (e.g. `zai-org/GLM-5-FP8` or `glm-5`)
7. Click **Verify** to test the connection
8. Select your custom model from the model dropdown in Chat, Composer, or Cmd+K

### 3. Open Modal Signup Quickly (CLI)

```bash
open "https://modal.com/glm-5-endpoint"
```

---

## Understanding the Enable Dialog

When you enable your own OpenAI API key, Cursor shows:

> Several of Cursor's features require custom models (Tab, Apply from Chat, Agent), which cannot be billed to an API key.

### What Uses Your API Key vs Cursor’s Billing

| Feature                                                  | Uses Your API Key? | Billing             |
| -------------------------------------------------------- | ------------------ | ------------------- |
| **Tab** (inline autocomplete)                            | No                 | Cursor subscription |
| **Apply from Chat** (applying chat suggestions to files) | No                 | Cursor subscription |
| **Agent** (Agent mode in Composer)                       | No                 | Cursor subscription |
| **Chat** (when you select your custom model)             | Yes                | Your API key        |
| **Composer** (when you select your custom model)         | Yes                | Your API key        |
| **Cmd+K** (when you select your custom model)            | Yes                | Your API key        |

### Using GLM-5 Only for Code Writing

You can use your custom model (e.g., GLM-5) only for writing code and keep Tab on Cursor’s model:

- **Tab** always uses Cursor’s model — you cannot replace it with a custom model
- **Chat, Composer, Cmd+K** use whichever model you select in the model dropdown
- Choose your custom model when you want GLM-5; use Composer 1.5 or others when you prefer Cursor’s models

---

## Configuration Reference

### Modal.com (GLM-5 free tier)

| Setting  | Value                                                             |
| -------- | ----------------------------------------------------------------- |
| API Key  | From [modal.com/glm-5-endpoint](https://modal.com/glm-5-endpoint) |
| Base URL | `https://api.us-west-2.modal.direct/v1`                           |
| Model    | `zai-org/GLM-5-FP8`                                               |

### Z.AI (GLM-5 paid)

| Setting  | Value                                                                     |
| -------- | ------------------------------------------------------------------------- |
| API Key  | From [z.ai](https://z.ai) or [open.bigmodel.cn](https://open.bigmodel.cn) |
| Base URL | `https://api.z.ai/api/paas/v4/`                                           |
| Model    | `glm-5`                                                                   |

---

## Single API Key Limitation

You **cannot** use a built-in Cursor model (e.g., Composer 1.5) alongside a custom model (e.g., GLM-5) at the same time. Cursor supports only **one** OpenAI API key configuration:

- With your custom key and base URL override enabled → your custom models work, but Cursor’s built-in models may fail (they get routed to your endpoint)
- With Cursor’s key (no override) → built-in models work, but you cannot use GLM-5 or other custom models

To switch between them, you must manually change the API key and override settings in the UI.

There is a [feature request for multiple API key configurations](https://forum.cursor.com/t/support-for-multiple-openai-api-key-configurations/41549) on the Cursor forum. The community has also asked for model and API key settings to be configurable via CLI or a config file, so agents could manage them automatically — this is not supported yet.

---

## Caveats

- **Tab completion** cannot use custom models; it always runs on Cursor Tab
- **Composer / Agent mode** may not fully support all custom models
- **Base URL override** can sometimes affect other models when enabled; if Composer 1.5 or others fail, try disabling the override temporarily
- Code is still sent through Cursor’s backend for prompt construction before reaching your API — see Cursor’s [BYOK documentation](https://docs.cursor.com/settings/api-keys) for details

---

## Related Links

- [Cursor Models Documentation](https://cursor.com/docs/models)
- [Cursor API Keys](https://docs.cursor.com/settings/api-keys)
- [Support for Multiple OpenAI API Key Configurations](https://forum.cursor.com/t/support-for-multiple-openai-api-key-configurations/41549) (feature request)
- [GLM-5 in Cursor (forum request)](https://forum.cursor.com/t/glm-5-in-cursor/151622)
- [Modal.com GLM-5 offer](https://modal.com/blog/try-glm-5)
- [Z.AI GLM-5 docs](https://docs.z.ai/guides/llm/glm-5)
