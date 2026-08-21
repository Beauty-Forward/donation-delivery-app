# Team Guide — Quick Version

*Running donations day to day. (More detail? See [the full guide](user-guide-internal.md).)*

---

## Your two tools

- 💳 **Givebutter** → did they pay?
- 🚚 **Roadie** → where's the courier? (and book/rebook one)

Everything else runs automatically. You **don't** touch the database — that's your
**technical contact**.

---

## When a donor asks…

```mermaid
flowchart TD
    Q{What are they asking?} --> A["Did my donation go through?"]
    Q --> B["Where's my courier?"]
    Q --> C["I paid but no pickup was booked"]

    A --> A2["Check 💳 Givebutter"]
    B --> B2["Check 🚚 Roadie"]
    C --> C2{Did they pay?<br/>Check Givebutter}
    C2 -->|Yes, but no courier| C3["🚚 Rebook in Roadie<br/>+ tell your tech contact"]
    C2 -->|No payment| C4["They didn't finish —<br/>ask them to complete it"]

    style C3 fill:#ffe0b2,stroke:#e65100
```

---

## The one thing that's yours to fix

**Paid, but no courier booked** → **rebook it in Roadie.** Then let your technical
contact know so they can tidy the record.

*One now and then = normal. Several at once = escalate.*

---

## Physical donations

- 📦 **Shipped** → donor mails it + emails you a tracking number. Watch for it.
- 📍 **Drop-off** → donor brings it during opening hours, leaves it at the front desk.

---

## Escalate to your tech contact when…

- Payment shows in Givebutter but nothing happened for days
- A donor got **no email at all**
- **Several** failed bookings at once
- Anything needing a look **inside the database**

*Include: donor name + email, when, which method, what they're seeing.*
