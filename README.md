# Razorpay Payments + Premium Gating (HabitTracker)

This is a **step-by-step implementation guide** for integrating **Razorpay** into this repo and enforcing:

- **FREE users**: max **5 habits**, **no AI Prompt Export**
- **PREMIUM users**: **unlimited habits**, **AI Prompt Export enabled**

The guide is written so you can implement manually. It also lists **exact files in this repo** to add/edit.

---

## 0) Current repo state (important)

Backend already contains placeholders for payments + subscriptions:

- Payments: `Backend/src/main/java/com/tracker/HabbitTracker/controller/PaymentController.java`
- Payment storage: `Backend/src/main/java/com/tracker/HabbitTracker/entity/payment/PaymentTransaction.java`
- Subscriptions: `Backend/src/main/java/com/tracker/HabbitTracker/controller/SubscriptionController.java`
- User plan/role: `Backend/src/main/java/com/tracker/HabbitTracker/entity/User.java` (`UserRole` has `FREE`, `PREMIUM`, `ADMIN`)
- AI prompt endpoint: `Backend/src/main/java/com/tracker/HabbitTracker/controller/AiPromptController.java`
- Habit creation: `Backend/src/main/java/com/tracker/HabbitTracker/service/HabitServiceImpl.java`

Frontend is plain static pages under `Frontend/` and calls backend via `Frontend/js/api.js`.

---

## 1) Decide how you represent “Premium” (pick one)

### Option A (fastest): use `User.role` only

- FREE vs PREMIUM is just `users.role`.
- On payment success, set `User.role = PREMIUM`.
- Premium never expires unless you implement downgrade later.

Files:
- Edit `Backend/src/main/java/com/tracker/HabbitTracker/entity/User.java` (role already exists)
- Add/update logic in a service (ex: `SubscriptionServiceImpl` or a new `BillingService`).

### Option B (recommended): use `Subscription` table for expiry + history, and also set role

You already have:
- `Subscription` + `SubscriptionPlan` entities and `/api/subscriptions/*` endpoints.

Recommended rule:
- If user has an ACTIVE subscription (today <= endDate), treat as premium.
- Set `User.role = PREMIUM` while active (or compute “isPremium” dynamically, but role is used by Spring Security).

Files:
- `Backend/src/main/java/com/tracker/HabbitTracker/service/SubscriptionServiceImpl.java`
- `Backend/src/main/java/com/tracker/HabbitTracker/repository/SubscriptionRepository.java`

This guide assumes **Option B** (because the repo already has subscription support), but you can adapt easily.

---

## 2) Razorpay basics you need (before coding)

1. Create Razorpay account.
2. Go to **Settings → API Keys** and generate:
   - `RAZORPAY_KEY_ID` (public)
   - `RAZORPAY_KEY_SECRET` (server-only)
3. Create a **Webhook Secret** in Razorpay dashboard (optional but recommended):
   - `RAZORPAY_WEBHOOK_SECRET`
4. Choose your plan prices (example):
   - PREMIUM_MONTHLY = 499 INR
   - PREMIUM_YEARLY = 4999 INR

Never put `KEY_SECRET` into frontend.

---

## 3) Backend: add Razorpay SDK + configuration

### 3.1 Add dependency

Edit `Backend/pom.xml`:

- Add Razorpay Java SDK dependency (and/or your preferred HTTP client).
- If you don’t want SDK, you can call Razorpay REST directly using `RestTemplate`/`WebClient`.

### 3.2 Add config values

Edit `Backend/src/main/resources/application.properties`:

- Add properties (or env-backed):
  - `razorpay.keyId`
  - `razorpay.keySecret`
  - `razorpay.webhookSecret`

If you use env vars:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

---

## 4) Backend: design the payment flow

You need 3 things:

1) **Create Order** (server → Razorpay)  
2) **Checkout** (client opens Razorpay UI using order_id)  
3) **Verify + Activate** (server verifies signature/payment + activates premium)

Recommended endpoints (add these):

- `POST /api/payments/razorpay/order`
  - Input: `planCode`
  - Output: `orderId`, `amount`, `currency`, `razorpayKeyId`, maybe `txId`

- `POST /api/payments/razorpay/verify`
  - Input: `orderId`, `paymentId`, `signature`, `planCode`
  - Server verifies signature (HMAC SHA256) and then:
    - marks transaction SUCCESS
    - activates subscription plan (or sets user role)

- `POST /api/payments/razorpay/webhook` (optional but recommended)
  - Razorpay calls this directly (payment.captured, etc.)
  - Verify webhook signature using webhook secret
  - Mark tx success and activate subscription (idempotent)

Files you will add/edit:

- Edit `Backend/src/main/java/com/tracker/HabbitTracker/controller/PaymentController.java`
- Edit `Backend/src/main/java/com/tracker/HabbitTracker/service/PaymentService.java`
- Edit `Backend/src/main/java/com/tracker/HabbitTracker/service/PaymentServiceImpl.java`
- Likely add a new service like `Backend/src/main/java/com/tracker/HabbitTracker/service/RazorpayService.java`
- Add new DTOs under `Backend/src/main/java/com/tracker/HabbitTracker/dto/`

---

## 5) Backend: store Razorpay identifiers properly (DB model)

Right now `PaymentTransaction` only has one field:
- `providerPaymentId` (required, not null)

But Razorpay has multiple IDs:
- `order_id` (created by server)
- `payment_id` (generated after payment)
- `signature` (for verification)

Recommended change (edit `Backend/src/main/java/com/tracker/HabbitTracker/entity/payment/PaymentTransaction.java`):

- Store BOTH orderId and paymentId, e.g.
  - `providerOrderId` (Razorpay order_id)
  - `providerPaymentId` (Razorpay payment_id)
  - `providerSignature` (optional)
- Also store which plan was purchased:
  - `planCode` OR FK to `SubscriptionPlan`

Repository changes likely needed:
- `Backend/src/main/java/com/tracker/HabbitTracker/repository/PaymentRepository.java`
  - Add finders by `providerOrderId`

DB migration:
- If you use Hibernate auto-ddl locally, it may update automatically.
- In production, add Flyway/Liquibase migration (if/when you introduce it).

---

## 6) Backend: activate premium after successful payment

You already have a “manual” activation endpoint:
- `POST /api/subscriptions/activate` in `Backend/src/main/java/com/tracker/HabbitTracker/controller/SubscriptionController.java`

For real payments, do **not** let frontend call activation directly.
Instead, in your Razorpay verify/webhook handler:

1. Verify payment is valid
2. Call `SubscriptionService.activateSubscriptionForCurrentUser(planCode, durationDays)`

Edit/add logic in:
- `Backend/src/main/java/com/tracker/HabbitTracker/service/SubscriptionServiceImpl.java`

Optional: sync user role for security/UX:
- If subscription becomes active: set `User.role = PREMIUM`
- If expired: set `User.role = FREE` (you can do this lazily at login/profile fetch)

You’ll likely implement role sync inside:
- `Backend/src/main/java/com/tracker/HabbitTracker/service/UserServiceImpl.java` or a new helper service

---

## 7) Feature gating rules (what you asked)

### 7.1 FREE users: max 5 habits

Backend enforcement (must-have; frontend checks are not enough):

1) Add a count query

Edit `Backend/src/main/java/com/tracker/HabbitTracker/repository/HabitRepository.java`:
- Add: `long countByUserAndActiveTrue(User user);`

2) Enforce in createHabit

Edit `Backend/src/main/java/com/tracker/HabbitTracker/service/HabitServiceImpl.java` inside `createHabit(...)`:
- If user is FREE (or not premium) AND activeHabitCount >= 5 → throw `BusinessException`

Where premium check can come from:
- Simple: `user.getRole() == UserRole.PREMIUM`
- Better: subscription is active (then role might be PREMIUM too)

Frontend UX (nice-to-have):

- Edit `Frontend/js/habit.js`:
  - On page load, call `getMyProfile()` and `getMyHabits()`
  - If role is FREE and habit count >= 5:
    - disable the Create button (`submitHabitBtn`)
    - show message: “Free plan supports up to 5 habits. Upgrade to Premium.”
- Edit `Frontend/habit.html` if you want a dedicated “Upgrade” banner/button.

### 7.2 FREE users: do not receive AI prompt

Backend enforcement:

- Edit `Backend/src/main/java/com/tracker/HabbitTracker/controller/AiPromptController.java`
- Before generating prompt, check premium entitlement:
  - If FREE → respond with 403 (recommended) or throw `BusinessException("Premium feature")`

Frontend UX:

- Edit `Frontend/history.html`:
  - Wrap “AI Prompt Export” section in a container with an id (example: `aiPromptSection`)
- Edit `Frontend/js/history.js`:
  - On init, call `getMyProfile()`
  - If role is FREE:
    - hide the AI Prompt Export section
    - optionally show an upgrade callout

---

## 8) Frontend: add “Upgrade” flow (minimal)

Best place in your UI today:
- Settings page has a “Plan” card placeholder: `Frontend/settings.html`

### 8.1 Add plan UI

Edit `Frontend/settings.html` and `Frontend/js/settings.js`:

- Add button: “Upgrade to Premium”
- Display current plan (already: `planLine`)
- Optional: list plans from backend:
  - `GET /api/subscriptions/plans`

### 8.2 Add Razorpay Checkout

In `Frontend/settings.html`, add:
- `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>`

Flow:

1) User clicks “Buy PREMIUM_MONTHLY”
2) Frontend calls backend `POST /api/payments/razorpay/order` with `planCode`
3) Backend returns `orderId` + `razorpayKeyId`
4) Frontend opens Razorpay Checkout using those values
5) On success, Razorpay returns:
   - `razorpay_payment_id`
   - `razorpay_order_id`
   - `razorpay_signature`
6) Frontend calls backend `POST /api/payments/razorpay/verify`
7) Backend verifies signature + activates subscription
8) Frontend refreshes:
   - `getMyProfile()` and/or `GET /api/subscriptions/my`
   - updates `planLine`

Files to edit/add:
- Edit `Frontend/settings.html`
- Edit `Frontend/js/settings.js`
- Edit `Frontend/js/api.js` (add helper functions for the new endpoints)

---

## 9) Razorpay verification (server-side essentials)

### 9.1 Signature verification (checkout success)

Razorpay signature is typically:

- signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)

Your backend verify endpoint must:

1) Recompute signature with `RAZORPAY_KEY_SECRET`
2) Compare with received signature (constant-time compare recommended)
3) Optionally fetch payment/order from Razorpay API to confirm amount/currency

### 9.2 Webhook verification (recommended)

Webhook signature uses **webhook secret** and request body.
Verify it for:
- payment.captured
- payment.failed

Keep webhook handler idempotent:
- If tx already SUCCESS, do nothing.

---

## 9.3 Copy/paste code templates (Backend)

Below are **code templates** you can copy into the exact files mentioned. Adjust package names only if you change structure.

### a) `application.properties` (keys)

Edit `Backend/src/main/resources/application.properties`:

```properties
# Razorpay
razorpay.keyId=${RAZORPAY_KEY_ID:}
razorpay.keySecret=${RAZORPAY_KEY_SECRET:}
razorpay.webhookSecret=${RAZORPAY_WEBHOOK_SECRET:}
```

### b) DTOs (add files)

Add `Backend/src/main/java/com/tracker/HabbitTracker/dto/RazorpayCreateOrderRequest.java`:

```java
package com.tracker.HabbitTracker.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RazorpayCreateOrderRequest {
    @NotBlank(message = "planCode is required")
    private String planCode; // e.g. PREMIUM_MONTHLY
}
```

Add `Backend/src/main/java/com/tracker/HabbitTracker/dto/RazorpayCreateOrderResponse.java`:

```java
package com.tracker.HabbitTracker.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class RazorpayCreateOrderResponse {
    private Long txId;                 // internal PaymentTransaction id (optional)
    private String planCode;

    private String razorpayKeyId;      // safe to expose to frontend
    private String orderId;            // Razorpay order_id

    private BigDecimal amount;         // rupees
    private Integer amountPaise;       // paise (Razorpay uses smallest unit)
    private String currency;           // INR
}
```

Add `Backend/src/main/java/com/tracker/HabbitTracker/dto/RazorpayVerifyPaymentRequest.java`:

```java
package com.tracker.HabbitTracker.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RazorpayVerifyPaymentRequest {
    @NotBlank(message = "planCode is required")
    private String planCode;

    @NotBlank(message = "orderId is required")
    private String orderId;

    @NotBlank(message = "paymentId is required")
    private String paymentId;

    @NotBlank(message = "signature is required")
    private String signature;
}
```

### c) PaymentTransaction fields (edit entity)

Edit `Backend/src/main/java/com/tracker/HabbitTracker/entity/payment/PaymentTransaction.java` (recommended fields):

```java
// Which plan user tried to buy (or store planId / FK if you prefer)
@Column(nullable = false, length = 64)
private String planCode;

// Razorpay order_id (created by server)
@Column(nullable = false, length = 128)
private String providerOrderId;

// Razorpay payment_id (known after checkout success)
@Column(length = 128)
private String providerPaymentId;
```

And update your repository (example):

Edit `Backend/src/main/java/com/tracker/HabbitTracker/repository/PaymentRepository.java`:

```java
Optional<PaymentTransaction> findByProviderAndProviderOrderId(String provider, String providerOrderId);
Optional<PaymentTransaction> findByProviderAndProviderPaymentId(String provider, String providerPaymentId);
```

### d) Razorpay signature verification helper (add file)

Add `Backend/src/main/java/com/tracker/HabbitTracker/service/RazorpaySignatureService.java`:

```java
package com.tracker.HabbitTracker.service;

import com.tracker.HabbitTracker.commonException.BusinessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

@Service
public class RazorpaySignatureService {

    private final String keySecret;

    public RazorpaySignatureService(@Value("${razorpay.keySecret}") String keySecret) {
        this.keySecret = keySecret;
    }

    public void verifyCheckoutSignature(String orderId, String paymentId, String signature) {
        try {
            String payload = orderId + "|" + paymentId;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(keySecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));

            boolean ok = MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8),
                    signature.getBytes(StandardCharsets.UTF_8)
            );
            if (!ok) throw new BusinessException("Invalid Razorpay signature");
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException("Signature verification failed");
        }
    }
}
```

### e) PaymentController endpoints (edit controller)

Edit `Backend/src/main/java/com/tracker/HabbitTracker/controller/PaymentController.java` and add:

```java
@PostMapping("/razorpay/order")
public ResponseEntity<RazorpayCreateOrderResponse> createRazorpayOrder(
        @Valid @RequestBody RazorpayCreateOrderRequest request
) {
    RazorpayCreateOrderResponse out = paymentService.createRazorpayOrder(request.getPlanCode());
    return ResponseEntity.ok(out);
}

@PostMapping("/razorpay/verify")
public ResponseEntity<SubscriptionResponse> verifyRazorpayPayment(
        @Valid @RequestBody RazorpayVerifyPaymentRequest request
) {
    Subscription sub = paymentService.verifyRazorpayAndActivateSubscription(
            request.getPlanCode(),
            request.getOrderId(),
            request.getPaymentId(),
            request.getSignature()
    );
    // Reuse SubscriptionController mapping or create a mapper util
    SubscriptionResponse dto = new SubscriptionResponse();
    dto.setId(sub.getId());
    dto.setPlanCode(sub.getPlan().getCode());
    dto.setPlanName(sub.getPlan().getName());
    dto.setStartDate(sub.getStartDate());
    dto.setEndDate(sub.getEndDate());
    dto.setStatus(sub.getStatus().name());
    return ResponseEntity.ok(dto);
}
```

Then extend `Backend/src/main/java/com/tracker/HabbitTracker/service/PaymentService.java` with:

```java
RazorpayCreateOrderResponse createRazorpayOrder(String planCode);
Subscription verifyRazorpayAndActivateSubscription(String planCode, String orderId, String paymentId, String signature);
```

And implement in `Backend/src/main/java/com/tracker/HabbitTracker/service/PaymentServiceImpl.java`:

```java
@Transactional
public RazorpayCreateOrderResponse createRazorpayOrder(String planCode) {
    User user = currentUserService.getCurrentUser();

    // Load plan from DB (recommended)
    SubscriptionPlan plan = planRepository.findByCode(planCode)
            .orElseThrow(() -> new BusinessException("Subscription plan not found: " + planCode));
    if (!Boolean.TRUE.equals(plan.getActive())) throw new BusinessException("Plan not active");

    // Create Razorpay order (you can call SDK or REST here)
    // Example uses a fake order id placeholder; replace with real Razorpay call
    String orderId = "order_TEMP_" + System.currentTimeMillis();
    int amountPaise = plan.getPrice().movePointRight(2).intValueExact(); // 499.00 -> 49900

    PaymentTransaction tx = PaymentTransaction.builder()
            .user(user)
            .provider("RAZORPAY")
            .planCode(planCode)
            .providerOrderId(orderId)
            .providerPaymentId("PENDING")
            .status(PaymentStatus.INITIATED)
            .amount(plan.getPrice())
            .currency(plan.getCurrency())
            .build();
    tx = paymentRepository.save(tx);

    RazorpayCreateOrderResponse out = new RazorpayCreateOrderResponse();
    out.setTxId(tx.getId());
    out.setPlanCode(planCode);
    out.setOrderId(orderId);
    out.setAmount(plan.getPrice());
    out.setAmountPaise(amountPaise);
    out.setCurrency(plan.getCurrency());
    out.setRazorpayKeyId(razorpayKeyId);
    return out;
}

@Transactional
public Subscription verifyRazorpayAndActivateSubscription(String planCode, String orderId, String paymentId, String signature) {
    signatureService.verifyCheckoutSignature(orderId, paymentId, signature);

    PaymentTransaction tx = paymentRepository
            .findByProviderAndProviderOrderId("RAZORPAY", orderId)
            .orElseThrow(() -> new BusinessException("Payment transaction not found"));

    if (tx.getStatus() == PaymentStatus.SUCCESS) {
        // idempotent
        return subscriptionService.getMyActiveSubscription();
    }

    tx.setProviderPaymentId(paymentId);
    tx.setStatus(PaymentStatus.SUCCESS);
    tx.setRawResponse("{\"orderId\":\"" + orderId + "\",\"paymentId\":\"" + paymentId + "\"}");
    paymentRepository.save(tx);

    SubscriptionPlan plan = planRepository.findByCode(planCode)
            .orElseThrow(() -> new BusinessException("Subscription plan not found: " + planCode));

    // Activate subscription (durationDays comes from plan)
    return subscriptionService.activateSubscriptionForCurrentUser(planCode, plan.getDurationDays());
}
```

Notes for the code above:
- You’ll need to inject: `SubscriptionPlanRepository planRepository`, `SubscriptionService subscriptionService`, `RazorpaySignatureService signatureService`,
  and `@Value("${razorpay.keyId}") String razorpayKeyId`.
- Replace the placeholder `order_TEMP_*` with a real Razorpay order id from Razorpay API.

---

## 9.4 Copy/paste code templates (Frontend)

### a) Add Razorpay checkout script

Edit `Frontend/settings.html` (in `<head>` or before closing `</body>`):

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

### b) Add API helpers

Edit `Frontend/js/api.js` and add:

```js
async function createRazorpayOrder(planCode) {
  return apiJson("/api/payments/razorpay/order", {
    method: "POST",
    body: JSON.stringify({ planCode })
  });
}

async function verifyRazorpayPayment(planCode, orderId, paymentId, signature) {
  return apiJson("/api/payments/razorpay/verify", {
    method: "POST",
    body: JSON.stringify({ planCode, orderId, paymentId, signature })
  });
}

async function getMySubscription() {
  return apiJson("/api/subscriptions/my", { method: "GET" });
}
```

### c) Open checkout + verify on success

Edit `Frontend/js/settings.js` (inside your click handler for “Upgrade”):

```js
async function buyPlan(planCode) {
  const order = await createRazorpayOrder(planCode);

  const options = {
    key: order.razorpayKeyId,
    amount: order.amountPaise,
    currency: order.currency,
    name: "HabitTracker",
    description: `Subscription: ${planCode}`,
    order_id: order.orderId,
    handler: async (resp) => {
      // resp.razorpay_order_id, resp.razorpay_payment_id, resp.razorpay_signature
      await verifyRazorpayPayment(
        planCode,
        resp.razorpay_order_id,
        resp.razorpay_payment_id,
        resp.razorpay_signature
      );
      // refresh UI
      const profile = await getMyProfile();
      document.getElementById("planLine").textContent = profile.role || "FREE";
      alert("Payment successful. Premium activated.");
    },
    modal: { ondismiss: () => {} }
  };

  const rzp = new Razorpay(options);
  rzp.open();
}
```

---

## 9.5 Copy/paste code templates (Subscription gating)

### a) FREE users max 5 habits (backend enforcement)

Edit `Backend/src/main/java/com/tracker/HabbitTracker/repository/HabitRepository.java`:

```java
long countByUserAndActiveTrue(User user);
```

Edit `Backend/src/main/java/com/tracker/HabbitTracker/service/HabitServiceImpl.java` inside `createHabit(...)`:

```java
if (user.getRole() == UserRole.FREE) {
    long activeCount = habitRepository.countByUserAndActiveTrue(user);
    if (activeCount >= 5) {
        throw new BusinessException("Free plan supports up to 5 habits. Upgrade to Premium.");
    }
}
```

### b) FREE users cannot access AI prompt (backend enforcement)

Edit `Backend/src/main/java/com/tracker/HabbitTracker/controller/AiPromptController.java`:

```java
private final CurrentUserService currentUserService;

@GetMapping("/monthly-prompt/{year}/{month}")
public ResponseEntity<AiPromptResponse> getMonthlyPrompt(@PathVariable("year") int year, @PathVariable("month") @Min(1) @Max(12) int month) {
    User user = currentUserService.getCurrentUser();
    if (user.getRole() == UserRole.FREE) {
        return ResponseEntity.status(403).build();
    }
    MonthlyExportTextResponse export = monthlyExportService.exportMonthAsText(year, month);
    AiPromptResponse response = aiPromptService.buildMonthlyAnalysisPrompt(export);
    return ResponseEntity.ok(response);
}
```

If you prefer the “subscription active” rule (instead of role), gate by `SubscriptionService.getMyActiveSubscription() != null`.

---

## 9.6 Copy/paste code templates (Subscription setup)

### a) Seed plans in DB (example SQL)

You need `subscription_plans` rows so `/api/subscriptions/plans` returns something.

If your DB naming strategy is snake_case (it is in this repo logs), a MySQL seed can look like:

```sql
INSERT INTO subscription_plans
  (code, name, description, price, currency, max_tasks_per_day, history_days, features_json, active, duration_days, created_at, updated_at)
VALUES
  ('FREE', 'Free', 'Free plan', 0.00, 'INR', 50, 30, '{\"aiPrompt\":false,\"maxHabits\":5}', 1, 36500, NOW(), NOW()),
  ('PREMIUM_MONTHLY', 'Premium (Monthly)', 'Unlimited habits + AI prompt', 499.00, 'INR', 200, 365, '{\"aiPrompt\":true,\"maxHabits\":999}', 1, 30, NOW(), NOW()),
  ('PREMIUM_YEARLY', 'Premium (Yearly)', 'Unlimited habits + AI prompt', 4999.00, 'INR', 200, 365, '{\"aiPrompt\":true,\"maxHabits\":999}', 1, 365, NOW(), NOW());
```

Adjust values to your business rules.

### b) Single “entitlements” helper (recommended)

Instead of checking `User.role` everywhere, create one place that decides:
- isPremium?
- maxHabits allowed?
- aiPrompt allowed?

Add `Backend/src/main/java/com/tracker/HabbitTracker/service/EntitlementService.java`:

```java
package com.tracker.HabbitTracker.service;

import com.tracker.HabbitTracker.entity.Subscription;
import com.tracker.HabbitTracker.entity.User;
import com.tracker.HabbitTracker.enumm.UserRole;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class EntitlementService {

    private final SubscriptionService subscriptionService;

    public boolean isPremium(User user) {
        if (user.getRole() == UserRole.ADMIN) return true;
        // Option B: subscription-based check
        Subscription sub = subscriptionService.getMyActiveSubscription();
        return sub != null;
    }

    public int maxHabits(User user) {
        return isPremium(user) ? 999 : 5;
    }

    public boolean aiPromptEnabled(User user) {
        return isPremium(user);
    }
}
```

Then use it in:
- `HabitServiceImpl.createHabit(...)` for the 5-habit limit
- `AiPromptController` for AI prompt gating

### c) Sync user role on activation (optional but useful for UI)

If you want frontend to show plan just from `getMyProfile()` (Settings currently uses `profile.role`):

Edit `Backend/src/main/java/com/tracker/HabbitTracker/service/SubscriptionServiceImpl.java`:

```java
Subscription subscription = subscriptionRepository.save(subscription);

// Optional: set role to PREMIUM for nicer UI
user.setRole(UserRole.PREMIUM);
userRepository.save(user);

return subscription;
```

Notes:
- You’ll need to inject `UserRepository` into `SubscriptionServiceImpl`.
- You’ll also need a strategy to downgrade after expiry (cron job / lazy check at login).

---

## 10) Files checklist (copy/paste)

### Backend (edit)
- `Backend/pom.xml` (add Razorpay SDK or HTTP client)
- `Backend/src/main/resources/application.properties` (razorpay keys)
- `Backend/src/main/java/com/tracker/HabbitTracker/controller/PaymentController.java` (add Razorpay endpoints)
- `Backend/src/main/java/com/tracker/HabbitTracker/service/PaymentService.java` (extend for Razorpay order/verify)
- `Backend/src/main/java/com/tracker/HabbitTracker/service/PaymentServiceImpl.java` (implement Razorpay calls + verification)
- `Backend/src/main/java/com/tracker/HabbitTracker/entity/payment/PaymentTransaction.java` (store order/payment ids + plan)
- `Backend/src/main/java/com/tracker/HabbitTracker/repository/HabitRepository.java` (add `countByUserAndActiveTrue`)
- `Backend/src/main/java/com/tracker/HabbitTracker/service/HabitServiceImpl.java` (enforce 5-habit limit)
- `Backend/src/main/java/com/tracker/HabbitTracker/controller/AiPromptController.java` (block FREE users)
- `Backend/src/main/java/com/tracker/HabbitTracker/service/SubscriptionServiceImpl.java` (activate plan after payment)

### Backend (add)
- `Backend/src/main/java/com/tracker/HabbitTracker/service/RazorpayService.java` (recommended)
- DTOs under `Backend/src/main/java/com/tracker/HabbitTracker/dto/`:
  - `RazorpayCreateOrderRequest.java`
  - `RazorpayCreateOrderResponse.java`
  - `RazorpayVerifyPaymentRequest.java`

### Frontend (edit)
- `Frontend/settings.html` (add Upgrade UI + Razorpay checkout.js)
- `Frontend/js/settings.js` (call create order → open checkout → verify)
- `Frontend/js/api.js` (add API wrapper functions)
- `Frontend/js/habit.js` (disable create when FREE and count>=5)
- `Frontend/history.html` + `Frontend/js/history.js` (hide AI Prompt section for FREE)

---

## 11) What “done” looks like

- FREE user:
  - Can create habits until they have 5 active habits; the 6th attempt fails on backend.
  - `GET /api/ai/monthly-prompt/...` returns 403 (or similar) and UI hides prompt export.
- PREMIUM user:
  - Can create more than 5 habits.
  - Can use AI Prompt Export.
  - Settings page shows plan as PREMIUM (or shows active subscription).
