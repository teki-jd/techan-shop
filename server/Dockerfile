# 自建服务器版后端镜像
# 零依赖：不需要 npm install，只把源码放进去
FROM node:20-alpine

# tzdata 让日志时间是中国时区；除此之外不装任何东西
RUN apk add --no-cache tzdata \
  && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TZ=Asia/Shanghai

WORKDIR /app

COPY package.json ./
COPY index.js actions.js ./
COPY lib ./lib
COPY public ./public

# 数据目录：容器内建好并交给 node 用户，宿主机用 -v 挂上来
RUN mkdir -p /app/data /app/public/uploads \
  && chown -R node:node /app

USER node
EXPOSE 3000

# 健康检查用 node 自带的 fetch，镜像里不装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
