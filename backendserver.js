// functions/index.js
// This file would be deployed as your Firebase Cloud Functions

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const getRawBody = require('raw-body'); // Used for parsing raw webhook body

// Initialize Firebase Admin SDK (for Firestore access)
admin.initializeApp();

// --- IMPORTANT CONFIGURATION ---
// You MUST set these environment variables in your Firebase project:
// firebase functions:config:set stripe.secret_key="sk_test_sk_live_51RkrpqGbwmDpCmSfSXenOQXe9rlkxzf5wc5GOfV2cIQyYxfpvs4XOFSY9dqLc7gTqoXQ12bXJRHoesXmmtfEgL03004dCh8xIP"
// firebase functions:config:set stripe.webhook_secret="whsec_u0L3alTAEnIOtxvT7SKOiaCGLRp6P6U1"
// firebase functions:config:set app.id="__app_id"
// firebase functions:config:set frontend_url="https://brookeinternet.github.io/The-Style-Nexus-Team/"
// --------------------------------

// Initialize Stripe with your Secret Key from Firebase environment config
const stripe = Stripe(functions.config().stripe.secret_key, {
    apiVersion: '2022-11-15', // Use a recent Stripe API version
});

/**
 * 1. createCheckoutSession (HTTP Callable Function)
 * This function is called from your frontend when a user clicks "Subscribe".
 * It securely creates a Stripe Checkout Session.
 */
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    // 1. Authentication Check: Ensure the user is logged in via Firebase Auth
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to subscribe.');
    }

    const userId = context.auth.uid; // Get the authenticated user's ID
    const priceId = data.priceId;     // Get the Stripe Price ID from the frontend request
    const successUrl = data.successUrl || `${functions.config().frontend.url}/success.html`; // Redirect after success
    const cancelUrl = data.cancelUrl || `${functions.config().frontend.url}/cancel.html`;   // Redirect after cancel

    if (!priceId) {
        throw new functions.https.HttpsError('invalid-argument', 'Price ID is required.');
    }

    try {
        // 2. Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription', // For recurring payments
            line_items: [{
                price: priceId, // The Stripe Price ID for your premium product
                quantity: 1,
            }],
            customer_email: context.auth.token.email, // Optional: Pre-fill email if available from Firebase Auth
            client_reference_id: userId, // IMPORTANT: Link Stripe session to your Firebase user ID
            success_url: successUrl,
            cancel_url: cancelUrl,
            // Add metadata if you want to pass more info to your webhook
            metadata: {
                firebaseUid: userId,
            },
        });

        // 3. Return the session ID to the frontend
        return { sessionId: session.id };

    } catch (error) {
        console.error('Error creating Stripe Checkout session:', error);
        // Throw an HTTPS error that can be caught on the frontend
        throw new functions.https.HttpsError('internal', 'Unable to create checkout session.', error.message);
    }
});

/**
 * 2. stripeWebhookHandler (HTTP Request Function)
 * This function receives webhook events from Stripe.
 * It updates the user's subscription status in Firestore based on these events.
 */
exports.stripeWebhookHandler = functions.https.onRequest(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const webhookSecret = functions.config().stripe.webhook_secret; // Your webhook secret

    let event;

    try {
        // 1. Parse and Verify Webhook Signature
        // Use raw-body to get the raw request body for signature verification
        const rawBody = await getRawBody(req);
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
        console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 2. Handle the Event Type
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            const userId = session.client_reference_id; // Get your Firebase user ID
            const customerId = session.customer;       // Stripe Customer ID
            const subscriptionId = session.subscription; // Stripe Subscription ID

            console.log(`✅ Checkout session completed for user ${userId}. Customer: ${customerId}, Subscription: ${subscriptionId}`);

            if (userId) {
                const userSubscriptionRef = admin.firestore()
                    .doc(`artifacts/${functions.config().app.id}/users/${userId}/subscriptions/premium`);

                try {
                    // Update user's subscription status in Firestore
                    await userSubscriptionRef.set({
                        active: true,
                        stripeCustomerId: customerId,
                        subscriptionId: subscriptionId,
                        status: 'active', // You can store Stripe subscription status
                        currentPeriodEnd: new Date(session.current_period_end * 1000), // Example: store end date
                        created: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true }); // Use merge to avoid overwriting other fields

                    console.log(`Firestore updated: User ${userId} is now premium.`);
                } catch (firestoreError) {
                    console.error(`Error updating Firestore for user ${userId}:`, firestoreError);
                    return res.status(500).send(`Firestore update error: ${firestoreError.message}`);
                }
            }
            break;

        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object;
            console.log(`Subscription deleted: ${deletedSubscription.id}`);

            // Find the user associated with this subscription and mark as inactive
            // This assumes you stored the subscriptionId with the user in Firestore
            const usersWithDeletedSubscriptionQuery = admin.firestore()
                .collectionGroup('subscriptions') // Use collectionGroup if 'subscriptions' is a subcollection
                .where('subscriptionId', '==', deletedSubscription.id);

            try {
                const querySnapshot = await usersWithDeletedSubscriptionQuery.get();
                if (!querySnapshot.empty) {
                    // Assuming one user per subscription for simplicity
                    const userSubscriptionDoc = querySnapshot.docs[0];
                    await userSubscriptionDoc.ref.update({ active: false, status: 'canceled' });
                    console.log(`Firestore updated: User ${userSubscriptionDoc.ref.parent.parent.id}'s subscription canceled.`);
                }
            } catch (firestoreError) {
                console.error(`Error updating Firestore for deleted subscription ${deletedSubscription.id}:`, firestoreError);
                return res.status(500).send(`Firestore update error: ${firestoreError.message}`);
            }
            break;

        // Add more cases for other relevant Stripe events (e.g., 'invoice.payment_failed', 'customer.subscription.updated')
        // to keep your Firestore data in sync with Stripe.

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    // 3. Respond to Stripe to acknowledge receipt of the event
    res.json({ received: true });
});
