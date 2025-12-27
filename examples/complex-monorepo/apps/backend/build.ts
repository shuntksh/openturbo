const delay = Math.floor(Math.random() * 2000) + 500;
console.log(`Building @complex/backend... (simulated ${delay}ms)`);
await new Promise((resolve) => setTimeout(resolve, delay));
console.log(`Built @complex/backend`);
