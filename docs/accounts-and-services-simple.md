# Accounts & Services — Quick Guide

_Every account the app uses, and where to sign in. **No passwords or secret values live
in this doc — or should ever be added to it.** (Full detail? See
[the detailed version](accounts-and-services.md).)_

---

## Who owns what

| Service                        | What it's for                       | Owned by                                       |
| ------------------------------ | ----------------------------------- | ---------------------------------------------- |
| 🔥 **Firebase / Google Cloud** | Database, backend, website, secrets | ⏳ Dev's account — **being transferred to BF** |
| 💳 **Givebutter**              | Takes the contribution              | ✅ Beauty Forward                              |
| 🚚 **Roadie**                  | The courier                         | ✅ Beauty Forward (team has logins)            |
| ✉️ **Resend**                  | Sends the emails                    | ✅ Beauty Forward (`info@beauty-forward.org`)  |
| 💻 **GitHub**                  | The code                            | ✅ Beauty Forward (admin)                      |

---

## Where to sign in

- 🔥 **Firebase** → [console.firebase.google.com](https://console.firebase.google.com) (project `beauty-forward`)
- 💳 **Givebutter** → [givebutter.com](https://givebutter.com)
- 🚚 **Roadie** → [connect.roadie.com](https://connect.roadie.com)
- ✉️ **Resend** → [resend.com](https://resend.com)
- 💻 **GitHub** → [the repo](https://github.com/Beauty-Forward/donation-delivery-app)

---

## Still to finish (handover)

- ⬜ Transfer **Firebase + Google Cloud** to a Beauty Forward account
- ⬜ Note the **Firebase spend so far**
- ⬜ Confirm BF's **Givebutter** login sees the same campaigns
- ⬜ Confirm **Roadie** production (not test) is live
- ⬜ Confirm the **Resend** sending domain is verified

---

## One rule

🔒 The most sensitive keys (Roadie, the Givebutter webhook secret) live in **Firebase's
secret store** — never in the code or a plain settings file. Keep them there.
