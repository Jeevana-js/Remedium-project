"""Auth routes — register and login."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.users import create_user, verify_user
from app.models.user import UserLogin, UserOut, UserRegister

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: UserRegister):
    user = create_user(body.name, body.email, body.password)
    if user is None:
        raise HTTPException(409, "An account with this email already exists.")
    return UserOut(name=user["name"], email=user["email"])


@router.post("/login", response_model=UserOut)
async def login(body: UserLogin):
    user = verify_user(body.email, body.password)
    if user is None:
        raise HTTPException(401, "Invalid email or password.")
    return UserOut(name=user["name"], email=user["email"])
