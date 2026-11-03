/* রুজি – সার্ভিস ওয়ার্কার (প্রস্তাবিত)
   নীতি: নিজের সাইটের ফাইল আগে নেট থেকে আনে, নেট না থাকলে ক্যাশ থেকে দেয়।
   তাই নতুন index.html দিলে আলাদা করে সংস্করণ নম্বর বাড়াতে হয় না।
   Firebase, Cloudinary ও Google Fonts-এর অনুরোধে হাত দেয় না। */
/* পুশ নোটিফিকেশন (Firebase Cloud Messaging): ব্যাকগ্রাউন্ডে এলে SDK নিজেই বিজ্ঞপ্তি দেখায়। অফলাইনে ইনস্টল হলেও যেন ভাঙে না, তাই try/catch। */
try {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  firebase.initializeApp({ apiKey: "AIzaSyC8-2etuX_Pd7wmMY-P9El0omNu3R-Z6EM", authDomain: "ruji-65f33.firebaseapp.com", projectId: "ruji-65f33", storageBucket: "ruji-65f33.firebasestorage.app", messagingSenderId: "1048988656486", appId: "1:1048988656486:web:42a738852930f4e07c1ea7" });
  firebase.messaging();
} catch (err) {}
var CACHE = "ruji-v1";
var CORE = ["./", "index.html", "privacy.html", "delete-account.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(r).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(r, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(r).then(function (m) { return m || caches.match("index.html"); });
    })
  );
});
