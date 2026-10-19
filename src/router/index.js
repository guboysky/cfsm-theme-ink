import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import ServerDetail from '../views/ServerDetail.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/server/:id', component: ServerDetail, props: true },
    { path: '/:pathMatch(.*)*', component: { template: '<div class="empty">404 · Page not found</div>' } }
  ],
  scrollBehavior: (to, from, saved) => to.path.startsWith('/server/') || from.path.startsWith('/server/') ? false : saved || { top: 0 }
})
