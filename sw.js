/* রুজি – সার্ভিস ওয়ার্কার (দ্রুত সংস্করণ)
   নীতি: নিজের সাইটের ফাইল সাথে সাথে ক্যাশ থেকে দেয়, আর পেছনে নেট থেকে নতুনটা এনে রাখে।
   তাই অ্যাপ ঝটপট খোলে। নতুন index.html দিলে পরের খোলায় নতুনটা দেখা যায়।
   Firebase-এর স্ক্রিপ্ট (সংস্করণ নির্দিষ্ট) একবার নামলে ক্যাশ থেকেই চলে।
   Firebase ডেটা, Cloudinary ও Google Fonts-এর অনুরোধে হাত দেয় না। */
try {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  firebase.initializeApp({ apiKey: "AIzaSyC8-2etuX_Pd7wmMY-P9El0omNu3R-Z6EM", authDomain: "ruji-65f33.firebaseapp.com", projectId: "ruji-65f33", storageBucket: "ruji-65f33.firebasestorage.app", messagingSenderId: "1048988656486", appId: "1:1048988656486:web:42a738852930f4e07c1ea7" });
  firebase.messaging();
} catch (err) {}
var CACHE = "ruji-v2", LIB = "ruji-lib-v1";
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
      return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== LIB; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);

  /* Firebase SDK ফাইল: সংস্করণ নম্বর ঠিক করা, তাই ক্যাশ থেকে আগে */
  if (u.origin === "https://www.gstatic.com" && u.pathname.indexOf("/firebasejs/") === 0) {
    e.respondWith(
      caches.open(LIB).then(function (c) {
        return c.match(r).then(function (m) {
          if (m) return m;
          return fetch(r).then(function (res) {
            if (res && res.ok) c.put(r, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  if (u.origin !== self.location.origin) return;

  /* নিজের সাইটের ফাইল: ক্যাশ থেকে সাথে সাথে, পেছনে নতুনটা এনে রাখা */
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(r, { ignoreSearch: true }).then(function (m) {
        var net = fetch(r).then(function (res) {
          if (res && res.ok) c.put(r, res.clone());
          return res;
        });
        if (m) { net.catch(function () {}); return m; }
        return net.catch(function () { return c.match("index.html"); });
      });
    })
  );
});
