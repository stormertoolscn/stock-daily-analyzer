import { createApp } from "vue";

import App from "./App.vue";
import "./assets/variables.css";
import "./assets/main.css";
import router from "./router";

createApp(App).use(router).mount("#app");
