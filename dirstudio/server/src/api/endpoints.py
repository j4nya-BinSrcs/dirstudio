from fastapi import APIRouter
# post(/scans) -> create a new scan 
# get(/scans) -> get all scans
# get(/scan/{id}) -> get specific scan
# delete(/scan/{id}) -> delete a scan

# get(/scan/{id}/analysis) -> get overview for a scan
# get(/scan/{id}/tree) -> get tree for a scan 
# get(/scan/{id}/tree/node) -> get node for lazy loading

router = APIRouter()

@router.post("/scans")
async def create_scan(request):...

@router.get("/scans")
async def get_scans():...

@router.get("/scans/{id}")
async def get_scan(id):...

@router.delete("/scans/{id}")
async def del_scan(id):...

@router.get("/scans/{id}/analysis")
async def get_analysis(id):...

