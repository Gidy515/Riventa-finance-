#[tokio::test]
async fn starts_local_near_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;

    println!("Sandbox started successfully.");
    println!("RPC endpoint: {}", worker.rpc_addr());

    Ok(())
}
