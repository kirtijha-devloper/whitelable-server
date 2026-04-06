# Frontend Instruction: Determine CC Bill Payment Success / Failure

This document explains how the frontend should interpret the response from `/api/bbps-cc/pay` (the CC bill payment endpoint). InstantPay considers a payment successful only if the response contains a `statuscode` of `TXN` or `TUP`.

---

## 0) Call `/api/bbps-cc/billers`

When loading billers, the frontend should handle both normal responses and InstantPay upstream failures. If InstantPay returns an error, the backend now forwards a readable message in `resp.message` and returns `502` for upstream failure.

```js
const resp = await fetch('/api/bbps-cc/billers', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
}).then(r => r.json());

if (!resp.success) {
  showError(resp.message || 'Unable to load billers. Please try again.');
  return;
}

const billers = resp.data;
```

### Error handling for biller load

- If `resp.success === false`, show `resp.message` to the user.
- If the backend returns a `502` status, this indicates an InstantPay upstream failure.
- For any other failure, fall back to: `Unable to load billers. Please try again.`

```js
if (!resp.success) {
  const clientMessage = resp.message || 'Unable to load billers. Please try again.';
  showError(clientMessage);
}
```

---

## 1) Call `/api/bbps-cc/pay`

Send JSON request as usual; include the `enquiryReferenceId` obtained from `/pre-payment-enquiry`.

```js
const resp = await fetch('/api/bbps-cc/pay', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    billerId,
    param1,
    param2,
    transactionAmount,
    customerMobile,
    paymentMode,
    paymentInfo,
    enquiryReferenceId, // required when fetchRequirement is MANDATORY
    geoCode,
    customerPan,
  }),
}).then(r => r.json());
```

---

## 2) Decide Success vs Failure

✅ Only treat the payment as **successful** when ALL of the following are true:

- `resp.success === true`
- `resp.statuscode === 'TXN'` **or** `resp.statuscode === 'TUP'`

```js
const isSuccess = resp.success === true && ['TXN', 'TUP'].includes(resp.statuscode);
```

---

## 3) Display the Result

### Success
```js
if (isSuccess) {
  showSuccess('Payment successful', resp);
}
```

### Failure
```js
if (!isSuccess) {
  showError(resp.message || 'Payment failed', resp);
}
```

> ✅ Tip: If you want better debugging, log the full response:
> ```js
> console.log('PAY RESPONSE', resp);
> ```

---

## 4) Why the UI might say “FAILED” even when the backend logs success

If the backend returns `success: true` but the frontend still shows “FAILED,” the frontend is likely using the wrong criteria (e.g. checking only `success` or the wrong `statuscode`).

Make sure your code checks for `statuscode === 'TXN'` or `'TUP'`.

---

## 5) Common fields to inspect on failure

When payment fails, include these in your debug output:

- `resp.statuscode`
- `resp.message`
- `resp.externalRef`
- `resp.data` (contains InstantPay details)

---

If you want, paste the exact JSON your frontend receives and I can tell you exactly what to display and why it’s failing.